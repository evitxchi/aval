/**
 * Shared daily spend guard for every Ask Aval endpoint (the Q&A tool loop
 * and the document-drafting stream). One row per model call in the
 * `ai_usage` table, so the cap is enforced by counting today's rows rather
 * than trusting an in-memory counter a Worker isolate wouldn't reliably
 * persist anyway.
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";
import { hasTokensRemaining } from "@/lib/billing/usage";
import type { AskAvalEnv } from "./anthropic";

export interface AskAvalSession {
  orgId: string;
  userId: string;
}

export function todayKey(): { day: string; dayStart: Date } {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return { day: dayStart.toISOString().slice(0, 10), dayStart };
}

async function isDailyCapExceeded(env: AskAvalEnv, session: AskAvalSession): Promise<boolean> {
  const db = getDb();
  const cap = Number(env.AI_DAILY_CALL_CAP ?? "400");
  const { day, dayStart } = todayKey();
  const usedToday = await db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, session.orgId), eq(aiUsage.day, day), gte(aiUsage.createdAt, dayStart)));
  return usedToday.length >= cap;
}

export type UsageBlockReason = "daily_cap" | "token_balance";

/** Two independent gates: a coarse daily-call safety valve, and the real plan/top-up token balance. */
export async function checkUsageBlocked(env: AskAvalEnv, session: AskAvalSession): Promise<UsageBlockReason | null> {
  if (!(await hasTokensRemaining(session.orgId))) return "token_balance";
  if (await isDailyCapExceeded(env, session)) return "daily_cap";
  return null;
}

export async function recordUsage(session: AskAvalSession, inputTokens: number, outputTokens: number) {
  try {
    const db = getDb();
    const { day } = todayKey();
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      organizationId: session.orgId,
      userId: session.userId,
      day,
      inputTokens,
      outputTokens,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("ask_aval_usage_write_failed", err);
  }
}
