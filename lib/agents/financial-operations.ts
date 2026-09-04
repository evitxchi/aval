/** Durable financial operation ledger and scheduled reconciliation. */

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentFinancialEvents, agentFinancialOperations } from "@/db/schema";
import { digestPayload } from "@/lib/audit/chain";
import { fingerprintAccount } from "./execution-policy.ts";
import {
  compareFinancialState,
  projectProviderReport,
  reconciliationBackoffMs,
  validateFinancialToolResult,
  type ExternalFinancialState,
} from "./reconciliation-rules.ts";

export type FinancialOperationRecord = typeof agentFinancialOperations.$inferSelect;

export async function reserveFinancialOperation(input: {
  organizationId: string;
  taskId: string;
  approvalId?: string;
  stepIndex: number;
  toolName: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  accountFingerprint: string;
  dailyLimitCents: number;
}): Promise<{ ok: true; operation: FinancialOperationRecord } | { ok: false; duplicate: boolean; reason: "duplicate" | "daily_limit" | "storage" }> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const row = {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    taskId: input.taskId,
    approvalId: input.approvalId ?? null,
    stepIndex: input.stepIndex,
    toolName: input.toolName,
    idempotencyKey: input.idempotencyKey,
    amountCents: input.amountCents,
    currency: input.currency,
    accountFingerprint: input.accountFingerprint,
    status: "reserved",
    reconciliationStatus: "pending",
    externalTransactionId: null,
    resultDigest: null,
    discrepancyCode: null,
    reconcileAttempts: 0,
    // The provider call has a 30-second ceiling. Waiting two minutes prevents
    // the cron from racing the still-in-flight side effect; if the executor
    // died, the delayed read-back safely classifies the unknown outcome.
    nextReconcileAt: new Date(now.getTime() + 2 * 60_000),
    lastReconciledAt: null,
    reconcileLeaseOwner: null,
    reconcileLeaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    settledAt: null,
  };
  try {
    // The aggregate cap and reservation are one SQLite statement. A separate
    // `SELECT sum(...)` followed by `INSERT` lets two concurrent approvals
    // both observe the same remaining budget and overspend it. SQLite
    // serializes these writes; the second statement sees the first row.
    const inserted = await getDb().run(sql`
      insert into ${agentFinancialOperations} (
        ${agentFinancialOperations.id}, ${agentFinancialOperations.organizationId},
        ${agentFinancialOperations.taskId}, ${agentFinancialOperations.approvalId},
        ${agentFinancialOperations.stepIndex}, ${agentFinancialOperations.toolName},
        ${agentFinancialOperations.idempotencyKey}, ${agentFinancialOperations.amountCents},
        ${agentFinancialOperations.currency}, ${agentFinancialOperations.accountFingerprint},
        ${agentFinancialOperations.status}, ${agentFinancialOperations.reconciliationStatus},
        ${agentFinancialOperations.externalTransactionId}, ${agentFinancialOperations.resultDigest},
        ${agentFinancialOperations.discrepancyCode}, ${agentFinancialOperations.reconcileAttempts},
        ${agentFinancialOperations.nextReconcileAt}, ${agentFinancialOperations.lastReconciledAt},
        ${agentFinancialOperations.reconcileLeaseOwner}, ${agentFinancialOperations.reconcileLeaseExpiresAt},
        ${agentFinancialOperations.createdAt}, ${agentFinancialOperations.updatedAt},
        ${agentFinancialOperations.settledAt}
      )
      select
        ${row.id}, ${row.organizationId}, ${row.taskId}, ${row.approvalId},
        ${row.stepIndex}, ${row.toolName}, ${row.idempotencyKey}, ${row.amountCents},
        ${row.currency}, ${row.accountFingerprint}, ${row.status},
        ${row.reconciliationStatus}, null, null, null, ${row.reconcileAttempts},
        ${row.nextReconcileAt.getTime()}, null, null, null,
        ${row.createdAt.getTime()}, ${row.updatedAt.getTime()}, null
      where (
        select coalesce(sum(${agentFinancialOperations.amountCents}), 0)
        from ${agentFinancialOperations}
        where ${agentFinancialOperations.organizationId} = ${input.organizationId}
          and ${agentFinancialOperations.createdAt} > ${since.getTime()}
          and ${agentFinancialOperations.status} in ('reserved', 'submitted', 'settled', 'unknown')
      ) + ${input.amountCents} <= ${input.dailyLimitCents}
    `);
    if (affectedRows(inserted) !== 1) {
      return { ok: false, duplicate: false, reason: "daily_limit" };
    }
    await appendFinancialEvent(row.id, input.organizationId, "reserved", await digestPayload({
      taskId: input.taskId,
      stepIndex: input.stepIndex,
      toolName: input.toolName,
      amountCents: input.amountCents,
      currency: input.currency,
      accountFingerprint: input.accountFingerprint,
    }));
    return { ok: true, operation: row };
  } catch (error) {
    const [existing] = await getDb().select().from(agentFinancialOperations)
      .where(eq(agentFinancialOperations.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { ok: false, duplicate: true, reason: "duplicate" };
    console.error("agent_financial_reservation_failed", { taskId: input.taskId, stepIndex: input.stepIndex, error });
    return { ok: false, duplicate: false, reason: "storage" };
  }
}

/**
 * A provider call is recorded as submitted even when the provider says
 * "settled". Only an independent read-back can settle Aval's projection.
 * Missing output is `unknown`, never `failed`: the side effect may have
 * happened.
 */
export async function recordFinancialToolResult(
  operationId: string,
  organizationId: string,
  result: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const validated = validateFinancialToolResult(result);
  const now = new Date();
  const resultDigest = await digestPayload(result);
  if (!validated.ok) {
    await getDb().update(agentFinancialOperations).set({
      status: "unknown",
      reconciliationStatus: "manual_review",
      discrepancyCode: "invalid_provider_result",
      resultDigest,
      updatedAt: now,
    }).where(and(eq(agentFinancialOperations.id, operationId), eq(agentFinancialOperations.organizationId, organizationId)));
    await appendFinancialEvent(operationId, organizationId, "provider_result_invalid", resultDigest);
    return validated;
  }

  const projection = projectProviderReport(validated.status);
  await getDb().update(agentFinancialOperations).set({
    // Even a provider-reported settlement remains submitted until the
    // independent reconciliation adapter reads and matches it.
    status: projection.operationStatus,
    reconciliationStatus: "pending",
    externalTransactionId: validated.externalTransactionId,
    resultDigest,
    nextReconcileAt: now,
    updatedAt: now,
    settledAt: null,
  }).where(and(eq(agentFinancialOperations.id, operationId), eq(agentFinancialOperations.organizationId, organizationId)));
  await appendFinancialEvent(operationId, organizationId, projection.eventKind, resultDigest, validated.externalTransactionId);
  return { ok: true };
}

export interface ReconciliationAdapter {
  lookup(operation: FinancialOperationRecord): Promise<ExternalFinancialState | "not_found">;
}

export interface ReconciliationEnv {
  STRIPE_SECRET_KEY?: string;
}

/** Reconcile all due operations with independent provider reads. */
export async function reconcileDueFinancialOperations(env: ReconciliationEnv, limit = 25): Promise<{ checked: number; matched: number; discrepancies: number; deferred: number }> {
  const now = new Date();
  const workerId = `reconcile_${crypto.randomUUID()}`;
  const operations = await getDb().select().from(agentFinancialOperations)
    .where(and(
      inArray(agentFinancialOperations.reconciliationStatus, ["pending", "provider_unavailable"]),
      lte(agentFinancialOperations.nextReconcileAt, now),
      or(isNull(agentFinancialOperations.reconcileLeaseExpiresAt), lt(agentFinancialOperations.reconcileLeaseExpiresAt, now)),
    ))
    .orderBy(asc(agentFinancialOperations.nextReconcileAt))
    .limit(limit);
  let matched = 0;
  let discrepancies = 0;
  let deferred = 0;
  let checked = 0;

  for (const operation of operations) {
    if (!(await claimReconciliation(operation, workerId, now))) continue;
    checked++;
    const adapter = adapterFor(operation, env);
    if (!adapter || !operation.externalTransactionId) {
      deferred++;
      await deferReconciliation(operation, adapter ? "external_id_missing" : "provider_unavailable", now);
      continue;
    }
    try {
      const observed = await adapter.lookup(operation);
      if (observed === "not_found") {
        discrepancies++;
        await writeReconciliation(operation, { status: "mismatch", code: "external_transaction_not_found" }, now);
        continue;
      }
      const verdict = compareFinancialState(operation, observed);
      if (verdict.status === "matched") matched++;
      else if (verdict.status === "mismatch" || verdict.status === "manual_review") discrepancies++;
      else deferred++;
      await writeReconciliation(operation, verdict, now, observed.externalTransactionId);
    } catch (error) {
      deferred++;
      console.error("agent_reconciliation_provider_error", { operationId: operation.id, tool: operation.toolName, error });
      await deferReconciliation(operation, "provider_error", now);
    }
  }
  return { checked, matched, discrepancies, deferred };
}

function adapterFor(operation: FinancialOperationRecord, env: ReconciliationEnv): ReconciliationAdapter | null {
  if (operation.toolName !== "issue_payment" || !env.STRIPE_SECRET_KEY) return null;
  return stripeTransferAdapter(env.STRIPE_SECRET_KEY);
}

/** Independent Stripe transfer read-back: amount, currency and destination must all match. */
export function stripeTransferAdapter(secret: string): ReconciliationAdapter {
  return {
    async lookup(operation) {
      const id = operation.externalTransactionId;
      if (!id || !/^tr_[A-Za-z0-9]+$/.test(id)) return "not_found";
      const response = await fetch(`https://api.stripe.com/v1/transfers/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${secret}`, "stripe-version": "2025-08-27.basil" },
      });
      if (response.status === 404) return "not_found";
      if (!response.ok) throw new Error(`Stripe reconciliation lookup failed (${response.status}).`);
      const value = await response.json() as { id?: unknown; amount?: unknown; currency?: unknown; destination?: unknown; reversed?: unknown };
      if (typeof value.id !== "string" || typeof value.amount !== "number" || typeof value.currency !== "string" || typeof value.destination !== "string") {
        throw new Error("Stripe reconciliation response was malformed.");
      }
      return {
        externalTransactionId: value.id,
        status: value.reversed === true ? "reversed" : "settled",
        amountCents: value.amount,
        currency: value.currency.toUpperCase(),
        accountFingerprint: await fingerprintAccount(value.destination),
      };
    },
  };
}

async function deferReconciliation(operation: FinancialOperationRecord, code: string, now: Date): Promise<void> {
  const attempt = operation.reconcileAttempts + 1;
  const tooOld = now.getTime() - operation.createdAt.getTime() > 24 * 60 * 60 * 1000;
  await getDb().update(agentFinancialOperations).set({
    status: operation.status === "reserved" ? "unknown" : operation.status,
    reconciliationStatus: tooOld ? "manual_review" : "provider_unavailable",
    discrepancyCode: code,
    reconcileAttempts: attempt,
    nextReconcileAt: new Date(now.getTime() + reconciliationBackoffMs(attempt)),
    lastReconciledAt: now,
    reconcileLeaseOwner: null,
    reconcileLeaseExpiresAt: null,
    updatedAt: now,
  }).where(eq(agentFinancialOperations.id, operation.id));
  await appendFinancialEvent(operation.id, operation.organizationId, tooOld ? "manual_review_required" : "reconciliation_deferred", await digestPayload(code), operation.externalTransactionId ?? undefined);
}

async function writeReconciliation(
  operation: FinancialOperationRecord,
  verdict: ReturnType<typeof compareFinancialState> | { status: "mismatch"; code: "external_transaction_not_found" },
  now: Date,
  externalTransactionId?: string,
): Promise<void> {
  const attempt = operation.reconcileAttempts + 1;
  const pending = verdict.status === "pending";
  const operationStatus = "operationStatus" in verdict ? verdict.operationStatus : operation.status;
  await getDb().update(agentFinancialOperations).set({
    status: operationStatus,
    reconciliationStatus: verdict.status,
    discrepancyCode: "code" in verdict ? verdict.code : null,
    reconcileAttempts: attempt,
    nextReconcileAt: new Date(now.getTime() + reconciliationBackoffMs(attempt)),
    lastReconciledAt: now,
    reconcileLeaseOwner: null,
    reconcileLeaseExpiresAt: null,
    updatedAt: now,
    ...(verdict.status === "matched" ? { settledAt: now } : {}),
  }).where(eq(agentFinancialOperations.id, operation.id));
  await appendFinancialEvent(operation.id, operation.organizationId, pending ? "reconciliation_pending" : `reconciliation_${verdict.status}`, await digestPayload(verdict), externalTransactionId);
}

async function claimReconciliation(operation: FinancialOperationRecord, workerId: string, now: Date): Promise<boolean> {
  const result = await getDb().update(agentFinancialOperations).set({
    reconcileLeaseOwner: workerId,
    reconcileLeaseExpiresAt: new Date(now.getTime() + 60_000),
    updatedAt: now,
  }).where(and(
    eq(agentFinancialOperations.id, operation.id),
    eq(agentFinancialOperations.reconciliationStatus, operation.reconciliationStatus),
    lte(agentFinancialOperations.nextReconcileAt, now),
    or(isNull(agentFinancialOperations.reconcileLeaseExpiresAt), lt(agentFinancialOperations.reconcileLeaseExpiresAt, now)),
  ));
  return affectedRows(result) === 1;
}

function affectedRows(result: unknown): number {
  const value = result as { rowsAffected?: number; meta?: { changes?: number }; changes?: number } | undefined;
  return value?.rowsAffected ?? value?.meta?.changes ?? value?.changes ?? -1;
}

async function appendFinancialEvent(operationId: string, organizationId: string, kind: string, payloadDigest: string, externalTransactionId?: string): Promise<void> {
  const [head] = await getDb().select({ sequence: agentFinancialEvents.sequence }).from(agentFinancialEvents)
    .where(eq(agentFinancialEvents.operationId, operationId))
    .orderBy(sql`${agentFinancialEvents.sequence} desc`).limit(1);
  await getDb().insert(agentFinancialEvents).values({
    id: crypto.randomUUID(),
    operationId,
    organizationId,
    sequence: (head?.sequence ?? 0) + 1,
    kind,
    payloadDigest,
    externalTransactionId: externalTransactionId ?? null,
    createdAt: new Date(),
  });
}
