/**
 * Per-organization spend ceiling, with visible degradation.
 *
 * The existing guard (`lib/ask-aval/usage.ts`) is a hard block: past the daily
 * call cap, a question gets an error. That is the right posture for a
 * dashboard, where the person is looking at the screen and can read why. It is
 * the wrong posture for a messaging channel, where a hard block means the
 * operator texts their assistant and nothing comes back — and "silently going
 * dark" is one of the two failures the brief names as worse than a downgrade.
 *
 * So this adds tiers in front of that block:
 *
 *   normal    →  full answer, best model
 *   reduced   →  answer, cheaper model, shorter render
 *   templated →  no model at all; gates and fixed replies still work
 *   blocked   →  one message saying the limit is reached and how to raise it
 *
 * The cap is **per organization, not per API key**. A key is shared across
 * tenants, so a key-level cap means one busy workspace silences every other
 * one — which is both unfair and invisible to the org actually causing it.
 *
 * Everything here counts against `ai_usage`, the table this product already
 * uses, so the channel and the dashboard draw down one budget. Two budgets
 * would mean an org that looks fine on one surface and is throttled on the
 * other, with nothing on screen explaining why.
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";
import { todayKey } from "@/lib/ask-aval/usage";

export type BudgetTier = "normal" | "reduced" | "templated" | "blocked";

export interface BudgetState {
  tier: BudgetTier;
  /** Calls used today, for the trace. */
  used: number;
  cap: number;
  /** True once the tier is anything but `normal` — the reply says so. */
  degraded: boolean;
}

/**
 * Fractions of the cap at which each tier begins.
 *
 * Degradation starts well before exhaustion on purpose. A ceiling that does
 * nothing until it is hit gives the operator no warning and no chance to raise
 * it; one that visibly shortens answers at 70% is a signal they can act on
 * while the channel still works.
 */
const REDUCED_AT = 0.7;
const TEMPLATED_AT = 0.9;

/** Default, matching `AI_DAILY_CALL_CAP`'s own default so the two cannot drift apart silently. */
const DEFAULT_CAP = 400;

/**
 * Where this organization sits against its ceiling.
 *
 * Counts rows rather than trusting a counter, for the reason
 * `lib/ask-aval/usage.ts` already documents: a Worker isolate does not
 * reliably persist an in-memory tally.
 */
export async function budgetFor(
  organizationId: string,
  config: { AI_DAILY_CALL_CAP?: string; CHANNEL_DAILY_CALL_CAP?: string } = {},
): Promise<BudgetState> {
  const parsed = Number(config.CHANNEL_DAILY_CALL_CAP ?? config.AI_DAILY_CALL_CAP ?? DEFAULT_CAP);
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP;

  const { day, dayStart } = todayKey();
  const rows = await getDb()
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, organizationId), eq(aiUsage.day, day), gte(aiUsage.createdAt, dayStart)));

  return stateFor(rows.length, cap);
}

/** The tier arithmetic, split out so it can be tested without a database. */
export function stateFor(used: number, cap: number): BudgetState {
  const ratio = cap > 0 ? used / cap : 1;
  const tier: BudgetTier = ratio >= 1 ? "blocked" : ratio >= TEMPLATED_AT ? "templated" : ratio >= REDUCED_AT ? "reduced" : "normal";
  return { tier, used, cap, degraded: tier !== "normal" };
}

/**
 * Whether a model may be called at this tier.
 *
 * `templated` and `blocked` both mean no. The difference between them is what
 * the recipient gets: a templated tier still answers anything the deterministic
 * path can answer — help, a subscription whose gate fired, a confirmation —
 * while `blocked` sends one message and stops.
 */
export function mayCallModel(tier: BudgetTier): boolean {
  return tier === "normal" || tier === "reduced";
}

/**
 * The render cap for a tier.
 *
 * A reduced answer is shorter, which is the cheapest visible signal that
 * something has changed — and it also genuinely costs fewer output tokens,
 * so the degradation is real rather than cosmetic.
 */
export function bodyCapFor(tier: BudgetTier): number {
  return tier === "reduced" ? 500 : 1000;
}

/**
 * Which model a tier should route to.
 *
 * Returns null for "no override" so the caller uses the org's configured
 * model. Naming a cheaper model here rather than in the caller keeps the
 * degradation ladder readable in one place.
 */
export function modelOverrideFor(tier: BudgetTier): string | null {
  return tier === "reduced" ? "claude-haiku-4-5-20251001" : null;
}
