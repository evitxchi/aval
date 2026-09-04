/**
 * Applies a planned import batch to the database.
 *
 * The thin half of the pair: `import-plan.ts` decides *what* happens and holds
 * every rule with a sharp edge; this walks the resulting plan in order and
 * writes. Same split as `metrics/` against the repositories, for the same
 * reason — the decisions stay testable without a D1 binding.
 *
 * **Idempotent, in two layers.** Every row is keyed on
 * `(organizationId, sourceProvider, externalId)`. A unique index on that
 * triple is the backstop that makes duplication impossible; the existence
 * checks below (`loadIdMap` for entities other rows reference,
 * `loadExistingEventIds` for the append-only ones) are what make a re-send
 * report cleanly as `unchanged` instead of as a wall of index violations.
 * Both layers are needed: the index alone left a nightly re-send reporting
 * every row as a failure, which is how this was found. A connector re-sending
 * its last 30 days is the normal case, not an error, and an importer that
 * doubled a portfolio's rent roll on the second run would be worse than one
 * that never ran.
 *
 * **A failure on one row does not abandon the rest.** D1 has no transaction
 * spanning these writes, so an all-or-nothing guarantee is not available to
 * claim. What is available is honesty about partial application: each failure
 * is caught, counted and returned, and the caller is told exactly how many
 * rows of each entity landed.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  glAccounts,
  glTransactions,
  leases,
  leasingLeads,
  ledgerEntries,
  properties,
  residents,
  syncRuns,
  units,
  vendors,
  workOrders,
} from "@/db/schema";
import { createGlAccount, postGlTransaction, postLedgerEntry } from "./accounting";
import { attachResidentToLease, createLead, createLease, createResident } from "./leasing";
import { createVendor, createWorkOrder, linkCallback } from "./maintenance";
import { upsertPropertyFromSource, upsertUnitFromSource } from "./portfolio";
import type { SourceRef } from "./provenance";
import {
  IMPORT_ORDER,
  planImport,
  type ImportBatch,
  type ImportEntity,
  type ImportGlAccount,
  type ImportGlTransaction,
  type ImportLead,
  type ImportLease,
  type ImportLedgerEntry,
  type ImportProperty,
  type ImportResident,
  type ImportUnit,
  type ImportVendor,
  type ImportWorkOrder,
  type SkippedRow,
} from "./import-plan.ts";
import type { LeaseStatus, PropertyType, ResidentStatus, UnitStatus, WorkOrderCategory, WorkOrderPriority, LedgerCategory, LedgerEntryType, GlAccountType } from "./types";

export interface ImportResult {
  applied: Record<ImportEntity, number>;
  /** Rows already present from this source, left as they were. */
  unchanged: Record<ImportEntity, number>;
  /** Field-level disagreements recorded against rows another source had written. */
  conflictsDetected: number;
  skipped: SkippedRow[];
  failed: { entity: ImportEntity; externalId: string; error: string }[];
}

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

/** External ids this workspace already holds, per entity, so the planner can resolve references against the database as well as the batch. */
async function loadKnownExternalIds(organizationId: string, sourceProvider: string) {
  const db = getDb();
  const scope = <T extends { organizationId: unknown; sourceProvider: unknown; externalId: unknown }>(table: T) =>
    and(
      eq(table.organizationId as never, organizationId),
      eq(table.sourceProvider as never, sourceProvider),
    );

  const [propertyRows, unitRows, residentRows, vendorRows, accountRows, leaseRows, workOrderRows] = await Promise.all([
    db.select({ externalId: properties.externalId }).from(properties).where(scope(properties)),
    db.select({ externalId: units.externalId }).from(units).where(scope(units)),
    db.select({ externalId: residents.externalId }).from(residents).where(scope(residents)),
    db.select({ externalId: vendors.externalId }).from(vendors).where(scope(vendors)),
    db.select({ externalId: glAccounts.externalId }).from(glAccounts).where(scope(glAccounts)),
    db.select({ externalId: leases.externalId }).from(leases).where(scope(leases)),
    db.select({ externalId: workOrders.externalId }).from(workOrders).where(scope(workOrders)),
  ]);

  const setOf = (rows: { externalId: string | null }[]) =>
    new Set(rows.map((row) => row.externalId).filter((id): id is string => id !== null));

  return {
    properties: setOf(propertyRows),
    units: setOf(unitRows),
    residents: setOf(residentRows),
    vendors: setOf(vendorRows),
    glAccounts: setOf(accountRows),
    leases: setOf(leaseRows),
    workOrders: setOf(workOrderRows),
  };
}

/**
 * Maps this source's external ids to the internal ids already stored, for
 * reference resolution during apply.
 *
 * Written out per table rather than through one generic helper: Drizzle's
 * table types do not unify into something a single query can be written
 * against, and the shapes that force a cast are exactly the ones where a
 * wrong column would fail silently at runtime.
 */
async function loadIdMap(organizationId: string, sourceProvider: string) {
  const db = getDb();
  const scoped = <T extends { organizationId: never; sourceProvider: never }>(table: T) =>
    and(eq(table.organizationId, organizationId), eq(table.sourceProvider, sourceProvider));
  const toMap = (rows: { id: string; externalId: string | null }[]) =>
    new Map(rows.filter((row) => row.externalId !== null).map((row) => [row.externalId as string, row.id]));

  const [propertyRows, unitRows, residentRows, vendorRows, accountRows, leaseRows, workOrderRows] = await Promise.all([
    db.select({ id: properties.id, externalId: properties.externalId }).from(properties).where(scoped(properties as never)),
    db.select({ id: units.id, externalId: units.externalId }).from(units).where(scoped(units as never)),
    db.select({ id: residents.id, externalId: residents.externalId }).from(residents).where(scoped(residents as never)),
    db.select({ id: vendors.id, externalId: vendors.externalId }).from(vendors).where(scoped(vendors as never)),
    db.select({ id: glAccounts.id, externalId: glAccounts.externalId }).from(glAccounts).where(scoped(glAccounts as never)),
    db.select({ id: leases.id, externalId: leases.externalId }).from(leases).where(scoped(leases as never)),
    db.select({ id: workOrders.id, externalId: workOrders.externalId }).from(workOrders).where(scoped(workOrders as never)),
  ]);

  return {
    properties: toMap(propertyRows),
    units: toMap(unitRows),
    residents: toMap(residentRows),
    vendors: toMap(vendorRows),
    glAccounts: toMap(accountRows),
    leases: toMap(leaseRows),
    workOrders: toMap(workOrderRows),
  };
}

/**
 * External ids already present for the three append-only entities.
 *
 * These carry no internal id anything else references, so unlike `loadIdMap`
 * only their presence matters. They still need loading: without it a re-sent
 * batch reaches the insert, the
 * `(organization_id, source_provider, external_id)` unique index rejects it,
 * and the row surfaces as a failure. The index does its job — nothing is
 * duplicated — but a nightly connector re-sending its last 30 days would
 * report hundreds of spurious failures and mark every run
 * `completed_with_errors`, which is exactly the normal case this endpoint
 * exists to serve. Found by re-sending a batch against production.
 */
async function loadExistingEventIds(organizationId: string, sourceProvider: string) {
  const db = getDb();
  const scoped = <T extends { organizationId: never; sourceProvider: never }>(table: T) =>
    and(eq(table.organizationId, organizationId), eq(table.sourceProvider, sourceProvider));
  const setOf = (rows: { externalId: string | null }[]) =>
    new Set(rows.map((row) => row.externalId).filter((id): id is string => id !== null));

  const [ledgerRows, transactionRows, leadRows] = await Promise.all([
    db.select({ externalId: ledgerEntries.externalId }).from(ledgerEntries).where(scoped(ledgerEntries as never)),
    db.select({ externalId: glTransactions.externalId }).from(glTransactions).where(scoped(glTransactions as never)),
    db.select({ externalId: leasingLeads.externalId }).from(leasingLeads).where(scoped(leasingLeads as never)),
  ]);

  return { ledgerEntries: setOf(ledgerRows), glTransactions: setOf(transactionRows), leads: setOf(leadRows) };
}

/**
 * Plans and applies a batch.
 *
 * `syncRunId`, when given, has its `countsJson` and status updated from the
 * result — so `POST /api/sync`'s run row stops being a promise about work a
 * worker would do later and becomes a record of what actually happened.
 */
export async function applyImport(
  organizationId: string,
  batch: ImportBatch,
  source: SourceRef,
  syncRunId?: string,
): Promise<ImportResult> {
  const known = await loadKnownExternalIds(organizationId, source.sourceProvider);
  const plan = planImport(batch, known);
  const ids = await loadIdMap(organizationId, source.sourceProvider);
  const existingEvents = await loadExistingEventIds(organizationId, source.sourceProvider);

  const applied = Object.fromEntries(IMPORT_ORDER.map((entity) => [entity, 0])) as Record<ImportEntity, number>;
  const unchanged = Object.fromEntries(IMPORT_ORDER.map((entity) => [entity, 0])) as Record<ImportEntity, number>;
  const failed: ImportResult["failed"] = [];
  let conflictsDetected = 0;

  /** Provenance for one row of this batch. */
  const refFor = (externalId: string): SourceRef => ({ ...source, externalId });

  for (const step of plan.steps) {
    for (const row of step.rows) {
      const externalId = (row as { externalId: string }).externalId;
      try {
        switch (step.entity) {
          case "properties": {
            const input = row as ImportProperty;
            const result = await upsertPropertyFromSource(
              organizationId,
              {
                name: input.name,
                addressLine1: input.addressLine1,
                city: input.city,
                region: input.region,
                postalCode: input.postalCode,
                country: input.country,
                propertyType: input.propertyType as PropertyType | undefined,
                reportedUnitCount: input.reportedUnitCount,
                yearBuilt: input.yearBuilt,
                squareFeet: input.squareFeet,
              },
              refFor(externalId),
            );
            ids.properties.set(externalId, result.property.id);
            conflictsDetected += result.conflicts;
            if (result.created) applied.properties += 1;
            else unchanged.properties += 1;
            break;
          }

          case "units": {
            const input = row as ImportUnit;
            const propertyId = ids.properties.get(input.propertyExternalId);
            if (!propertyId) throw new Error(`property "${input.propertyExternalId}" resolved in planning but not at apply time`);
            const result = await upsertUnitFromSource(
              organizationId,
              {
                propertyId,
                unitNumber: input.unitNumber,
                bedrooms: input.bedrooms,
                bathrooms: input.bathrooms,
                squareFeet: input.squareFeet,
                marketRentCents: input.marketRentCents,
                status: input.status as UnitStatus | undefined,
                vacantSince: date(input.vacantSince),
              },
              refFor(externalId),
            );
            ids.units.set(externalId, result.unit.id);
            conflictsDetected += result.conflicts;
            if (result.created) applied.units += 1;
            else unchanged.units += 1;
            break;
          }

          case "residents": {
            if (ids.residents.has(externalId)) { unchanged.residents += 1; break; }
            const input = row as ImportResident;
            const created = await createResident(
              organizationId,
              { displayName: input.displayName, email: input.email, phone: input.phone, status: input.status as ResidentStatus | undefined },
              refFor(externalId),
            );
            ids.residents.set(externalId, created.id);
            applied.residents += 1;
            break;
          }

          case "vendors": {
            if (ids.vendors.has(externalId)) { unchanged.vendors += 1; break; }
            const input = row as ImportVendor;
            const created = await createVendor(
              organizationId,
              { name: input.name, trade: input.trade, email: input.email, phone: input.phone, insuranceExpiresAt: date(input.insuranceExpiresAt) },
              refFor(externalId),
            );
            ids.vendors.set(externalId, created.id);
            applied.vendors += 1;
            break;
          }

          case "glAccounts": {
            if (ids.glAccounts.has(externalId)) { unchanged.glAccounts += 1; break; }
            const input = row as ImportGlAccount;
            const created = await createGlAccount(
              organizationId,
              { code: input.code, name: input.name, accountType: input.accountType as GlAccountType, isTrustAccount: input.isTrustAccount },
              refFor(externalId),
            );
            ids.glAccounts.set(externalId, created.id);
            applied.glAccounts += 1;
            break;
          }

          case "leases": {
            if (ids.leases.has(externalId)) { unchanged.leases += 1; break; }
            const input = row as ImportLease;
            const unitId = ids.units.get(input.unitExternalId);
            if (!unitId) throw new Error(`unit "${input.unitExternalId}" resolved in planning but not at apply time`);
            const created = await createLease(
              organizationId,
              {
                unitId,
                status: input.status as LeaseStatus | undefined,
                startDate: new Date(input.startDate),
                endDate: date(input.endDate),
                isMonthToMonth: input.isMonthToMonth,
                rentCents: input.rentCents,
                depositCents: input.depositCents,
                rentDueDay: input.rentDueDay,
                renewalOfLeaseId: input.renewalOfExternalId ? ids.leases.get(input.renewalOfExternalId) ?? null : null,
              },
              refFor(externalId),
            );
            ids.leases.set(externalId, created.id);
            for (const residentExternalId of input.residentExternalIds ?? []) {
              const residentId = ids.residents.get(residentExternalId);
              if (residentId) await attachResidentToLease(organizationId, created.id, residentId);
            }
            applied.leases += 1;
            break;
          }

          case "ledgerEntries": {
            if (existingEvents.ledgerEntries.has(externalId)) { unchanged.ledgerEntries += 1; break; }
            const input = row as ImportLedgerEntry;
            const leaseId = ids.leases.get(input.leaseExternalId);
            if (!leaseId) throw new Error(`lease "${input.leaseExternalId}" resolved in planning but not at apply time`);
            await postLedgerEntry(
              organizationId,
              {
                leaseId,
                entryType: input.entryType as LedgerEntryType,
                category: input.category as LedgerCategory,
                amountCents: input.amountCents,
                postedAt: new Date(input.postedAt),
                dueAt: date(input.dueAt),
                memo: input.memo,
              },
              refFor(externalId),
            );
            applied.ledgerEntries += 1;
            break;
          }

          case "workOrders": {
            if (ids.workOrders.has(externalId)) { unchanged.workOrders += 1; break; }
            const input = row as ImportWorkOrder;
            const propertyId = ids.properties.get(input.propertyExternalId);
            if (!propertyId) throw new Error(`property "${input.propertyExternalId}" resolved in planning but not at apply time`);
            const created = await createWorkOrder(
              organizationId,
              {
                propertyId,
                unitId: input.unitExternalId ? ids.units.get(input.unitExternalId) ?? null : null,
                category: input.category as WorkOrderCategory | undefined,
                priority: input.priority as WorkOrderPriority | undefined,
                summary: input.summary,
                reportedAt: new Date(input.reportedAt),
                vendorId: input.vendorExternalId ? ids.vendors.get(input.vendorExternalId) ?? null : null,
                estimateCents: input.estimateCents,
              },
              refFor(externalId),
            );
            ids.workOrders.set(externalId, created.id);

            // Lifecycle timestamps and cost come from the source rather than
            // from this app's own transitions, so they are written directly —
            // going through assign/start/complete would stamp "now" and
            // destroy the very durations the maintenance metrics measure.
            const completedAt = date(input.completedAt);
            const assignedAt = date(input.assignedAt);
            if (completedAt || assignedAt || input.actualCostCents !== undefined) {
              await getDb()
                .update(workOrders)
                .set({
                  assignedAt: assignedAt ?? undefined,
                  completedAt: completedAt ?? undefined,
                  actualCostCents: input.actualCostCents ?? undefined,
                  status: completedAt ? "completed" : assignedAt ? "assigned" : undefined,
                  updatedAt: new Date(),
                })
                .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, created.id)));
            }
            if (input.callbackOfExternalId) {
              const originalId = ids.workOrders.get(input.callbackOfExternalId);
              // A callback link asserted by the source system is a human
              // assertion made there, which is exactly what firstTimeFixPct
              // requires — unlike Aval's own proximity suggestions.
              if (originalId) await linkCallback(organizationId, created.id, originalId);
            }
            applied.workOrders += 1;
            break;
          }

          case "glTransactions": {
            if (existingEvents.glTransactions.has(externalId)) { unchanged.glTransactions += 1; break; }
            const input = row as ImportGlTransaction;
            const accountId = ids.glAccounts.get(input.accountExternalId);
            if (!accountId) throw new Error(`GL account "${input.accountExternalId}" resolved in planning but not at apply time`);
            await postGlTransaction(
              organizationId,
              {
                accountId,
                propertyId: input.propertyExternalId ? ids.properties.get(input.propertyExternalId) ?? null : null,
                amountCents: input.amountCents,
                postedAt: new Date(input.postedAt),
                memo: input.memo,
              },
              refFor(externalId),
            );
            applied.glTransactions += 1;
            break;
          }

          case "leads": {
            if (existingEvents.leads.has(externalId)) { unchanged.leads += 1; break; }
            const input = row as ImportLead;
            const created = await createLead(
              organizationId,
              {
                propertyId: input.propertyExternalId ? ids.properties.get(input.propertyExternalId) ?? null : null,
                unitId: input.unitExternalId ? ids.units.get(input.unitExternalId) ?? null : null,
                channel: input.channel,
                unitTypeLabel: input.unitTypeLabel,
                inquiredAt: new Date(input.inquiredAt),
              },
              refFor(externalId),
            );
            // Stage timestamps are written as the source recorded them. The
            // funnel's whole value is the real elapsed time between stages,
            // which advanceLead's "stamp now" behavior would erase.
            const stamps = {
              contactedAt: date(input.contactedAt),
              touredAt: date(input.touredAt),
              appliedAt: date(input.appliedAt),
              approvedAt: date(input.approvedAt),
              signedAt: date(input.signedAt),
              lostAt: date(input.lostAt),
            };
            const stage = stamps.signedAt
              ? "signed"
              : stamps.lostAt
                ? "lost"
                : stamps.approvedAt
                  ? "approved"
                  : stamps.appliedAt
                    ? "applied"
                    : stamps.touredAt
                      ? "toured"
                      : stamps.contactedAt
                        ? "contacted"
                        : "inquiry";
            await getDb()
              .update(leasingLeads)
              .set({ ...stamps, stage, lostReason: input.lostReason ?? null, updatedAt: new Date() })
              .where(and(eq(leasingLeads.organizationId, organizationId), eq(leasingLeads.id, created.id)));
            applied.leads += 1;
            break;
          }
        }
      } catch (error) {
        // One bad row does not abandon the batch. D1 gives no transaction
        // across these writes, so the honest guarantee is a full account of
        // what landed and what did not — not a claim of atomicity.
        failed.push({ entity: step.entity, externalId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const result: ImportResult = { applied, unchanged, conflictsDetected, skipped: plan.skipped, failed };

  if (syncRunId) {
    await getDb()
      .update(syncRuns)
      .set({
        status: failed.length > 0 ? "completed_with_errors" : "completed",
        countsJson: JSON.stringify({ applied, unchanged, skipped: plan.skipped.length, failed: failed.length, conflicts: conflictsDetected }),
        error: failed.length > 0 ? `${failed.length} row(s) failed to apply` : null,
        completedAt: new Date(),
      })
      .where(and(eq(syncRuns.organizationId, organizationId), eq(syncRuns.id, syncRunId)));
  }

  return result;
}
