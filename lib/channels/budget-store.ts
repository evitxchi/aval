/**
 * Reading an organization's position against its ceiling.
 *
 * The one part of the spend guard that needs a database, kept apart from the
 * tier arithmetic in `budget.ts` so the ladder — when degradation starts, what
 * each tier costs — stays testable without one.
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";
import { todayKey } from "@/lib/ask-aval/usage";
import { DEFAULT_CAP, stateFor, type BudgetState } from "./budget.ts";

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

