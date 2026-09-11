/**
 * Finding conversations that have gone quiet.
 *
 * The database half of the adaptive follow-up, kept apart from the timing rules
 * in `follow-up.ts` so the part with real judgement in it — median not mean,
 * measure from the first message of a run not the last — can be tested without
 * a database.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { MAX_ATTEMPTS, historyFrom, intervalFor } from "./follow-up.ts";

export interface FollowUpCandidate {
  conversationId: string;
  organizationId: string;
  externalThreadId: string;
  contactDisplayName: string;
  lastOutboundAt: Date;
  attempts: number;
  intervalMs: number;
  /** True once attempts are exhausted: stop chasing, tell a person. */
  handoff: boolean;
}

/**
 * Conversations that have gone quiet past their adaptive interval.
 *
 * Only conversations whose **last** message was outbound are candidates: a
 * thread where the contact spoke last is not waiting on them, it is waiting on
 * us, and chasing it would be answering our own message.
 */
export async function findFollowUps(organizationId: string, now = new Date()): Promise<FollowUpCandidate[]> {
  const db = getDb();

  const threads = await db
    .select({
      id: conversations.id,
      externalThreadId: conversations.externalThreadId,
      contactDisplayName: conversations.contactDisplayName,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.channel, "whatsapp"),
        eq(conversations.status, "open"),
      ),
    )
    .limit(200);

  const candidates: FollowUpCandidate[] = [];

  for (const thread of threads) {
    const rows = await db
      .select({ direction: messages.direction, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, thread.id))
      .orderBy(asc(messages.createdAt))
      .limit(200);

    if (rows.length === 0) continue;
    const last = rows[rows.length - 1];
    // They spoke last. Nothing to chase.
    if (last.direction !== "outbound") continue;

    const history = historyFrom(rows);
    const intervalMs = intervalFor(history);
    const elapsed = now.getTime() - last.createdAt.getTime();
    if (elapsed < intervalMs) continue;

    // Consecutive unanswered outbound messages at the tail, which is the
    // attempt count for *this* silence rather than for the whole thread.
    let attempts = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].direction === "outbound"; i -= 1) attempts += 1;

    candidates.push({
      conversationId: thread.id,
      organizationId,
      externalThreadId: thread.externalThreadId,
      contactDisplayName: thread.contactDisplayName,
      lastOutboundAt: last.createdAt,
      attempts,
      intervalMs,
      handoff: attempts >= MAX_ATTEMPTS,
    });
  }

  return candidates;
}

