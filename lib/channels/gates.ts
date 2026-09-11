/**
 * Script gates: deterministic SQL that runs *before* the model.
 *
 * This is the difference between a subscription that costs nothing on a quiet
 * week and one that pays for a model call every Monday to discover that
 * nothing happened. Monday 08:00 fires the gate; the gate is a query; if it
 * returns no rows, there is no message, no model call, and no tokens.
 *
 * Three properties make a gate a gate rather than a pre-prompt:
 *
 *  - **It is SQL, not a model.** The decision to notify is arithmetic over the
 *    ledger. A model asked "is this worth telling them about?" would be both
 *    slower and less predictable than `HAVING sum(...) > threshold`.
 *  - **Its result is the evidence.** The rows the gate returns are handed to
 *    the renderer as facts. The model, when it runs at all, writes prose
 *    *around* figures it did not compute.
 *  - **An empty result is a complete answer.** "Nothing crossed a threshold"
 *    is the correct output for most runs and must cost nothing to produce.
 *
 * Every gate here is org-scoped in its `where` clause. That is the same
 * application-level scoping the rest of this codebase relies on, and the
 * isolation test in `tests/integration/channel-isolation.integration.mjs`
 * covers these queries specifically because a subscription runs unattended —
 * a leak here would send one customer's delinquency figures to another's
 * phone, with no human in the loop to notice.
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { leases, ledgerEntries, properties, units } from "@/db/schema";

/** The gates a subscription may name. A `gate` column value outside this set never runs. */
export type GateId = "delinquency_threshold" | "weekly_summary";

export const GATE_IDS: readonly GateId[] = ["delinquency_threshold", "weekly_summary"];

export function isGateId(value: unknown): value is GateId {
  return typeof value === "string" && (GATE_IDS as readonly string[]).includes(value);
}

/** One row of evidence a gate produced. Figures are cents; formatting happens at render time. */
export interface GateRow {
  label: string;
  amountCents: number;
  days?: number;
  propertyName?: string;
}

export interface GateResult {
  /** False means: send nothing, call nothing. The common case. */
  fired: boolean;
  rows: GateRow[];
  /** Headline figures, already aggregated by SQL rather than by a model. */
  totalCents: number;
}

const EMPTY: GateResult = { fired: false, rows: [], totalCents: 0 };

/**
 * Balance outstanding per lease, aged past a threshold.
 *
 * Aging is measured from `due_at`, which the schema sets on charges and leaves
 * null on payments — a payment is not owed on a date. So the age of a debt is
 * the age of its oldest unpaid charge, and the balance is charges minus
 * payments and credits over the whole lease, not just the aged window. Netting
 * only the aged window would report a resident who paid last week as still 60
 * days late.
 */
export async function delinquencyGate(input: {
  organizationId: string;
  minCents: number;
  minDays: number;
  now?: Date;
}): Promise<GateResult> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.minDays * 86_400_000);

  const rows = await getDb()
    .select({
      leaseId: ledgerEntries.leaseId,
      propertyName: properties.name,
      unitLabel: units.unitNumber,
      // Charges add, everything else subtracts. `entry_type` is the
      // authority here, not the sign of the amount.
      balanceCents: sql<number>`sum(case when ${ledgerEntries.entryType} = 'charge' then ${ledgerEntries.amountCents} else -${ledgerEntries.amountCents} end)`,
      oldestDueAt: sql<number>`min(case when ${ledgerEntries.entryType} = 'charge' and ${ledgerEntries.dueAt} is not null then ${ledgerEntries.dueAt} end)`,
    })
    .from(ledgerEntries)
    .innerJoin(leases, and(eq(leases.id, ledgerEntries.leaseId), eq(leases.organizationId, input.organizationId)))
    .innerJoin(units, and(eq(units.id, leases.unitId), eq(units.organizationId, input.organizationId)))
    .innerJoin(properties, and(eq(properties.id, leases.propertyId), eq(properties.organizationId, input.organizationId)))
    .where(and(eq(ledgerEntries.organizationId, input.organizationId), eq(leases.status, "active")))
    .groupBy(ledgerEntries.leaseId, properties.name, units.unitNumber)
    .having(
      sql`sum(case when ${ledgerEntries.entryType} = 'charge' then ${ledgerEntries.amountCents} else -${ledgerEntries.amountCents} end) >= ${input.minCents}
          and min(case when ${ledgerEntries.entryType} = 'charge' and ${ledgerEntries.dueAt} is not null then ${ledgerEntries.dueAt} end) <= ${cutoff.getTime()}`,
    );

  if (rows.length === 0) return EMPTY;

  const evidence = rows.map((row) => ({
    label: `${row.propertyName} ${row.unitLabel}`.trim(),
    amountCents: Number(row.balanceCents),
    days: row.oldestDueAt ? Math.floor((now.getTime() - Number(row.oldestDueAt)) / 86_400_000) : undefined,
    propertyName: row.propertyName,
  }));

  return {
    fired: true,
    rows: evidence,
    totalCents: evidence.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

/**
 * The week's collections and what is still open.
 *
 * Fires only when something actually moved. A Monday summary that says "no
 * activity last week" every week for a small portfolio is a notification
 * people mute, and a muted channel is a channel that has stopped working.
 */
export async function weeklySummaryGate(input: { organizationId: string; now?: Date }): Promise<GateResult> {
  const now = input.now ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [collected] = await getDb()
    .select({
      totalCents: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.organizationId, input.organizationId),
        eq(ledgerEntries.entryType, "payment"),
        gte(ledgerEntries.postedAt, weekAgo),
        lt(ledgerEntries.postedAt, now),
      ),
    );

  const total = Number(collected?.totalCents ?? 0);
  const count = Number(collected?.count ?? 0);
  if (count === 0) return EMPTY;

  return {
    fired: true,
    rows: [{ label: "payments", amountCents: total }],
    totalCents: total,
  };
}

/** Run a gate by id. An unknown id does not fire, which is the safe direction. */
export async function runGate(
  gate: string,
  input: { organizationId: string; params: Record<string, unknown>; now?: Date },
): Promise<GateResult> {
  if (!isGateId(gate)) return EMPTY;
  if (gate === "delinquency_threshold") {
    return delinquencyGate({
      organizationId: input.organizationId,
      // Defaults chosen to match what an operator would call "late": a month
      // past due and more than a token amount.
      minCents: numeric(input.params.minCents, 50_000),
      minDays: numeric(input.params.minDays, 30),
      now: input.now,
    });
  }
  return weeklySummaryGate({ organizationId: input.organizationId, now: input.now });
}

/** A stored param is JSON and may be anything. Fall back rather than NaN. */
function numeric(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
