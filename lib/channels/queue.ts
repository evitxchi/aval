/**
 * The durable queue between the webhook and the agent.
 *
 *   webhook → inbound (integration_events) → worker → agent run →
 *   outbound (communication_deliveries) → Meta
 *
 * Two stores, exactly one writer each. The webhook only ever inserts into
 * `integration_events`; the worker only ever inserts into
 * `communication_deliveries`. Nothing in between holds state in memory, so a
 * Worker isolate dying between the two loses nothing that was not already
 * durable.
 *
 * There is no Cloudflare Queue and no Durable Object in this account
 * (`wrangler.deploy.jsonc` declares neither), so this is the brief's third
 * option: an event log drained by a cron worker. That was already this
 * codebase's pattern for integration sync and agent tasks, and the one-minute
 * cron that drains it already exists in `worker/index.ts`.
 *
 * **No model call happens on the request path.** The webhook's only job is to
 * verify, record, and acknowledge inside a second — Meta retries a slow
 * handler, and a retry that produces a second reply is a message a customer
 * receives twice.
 */

import { and, asc, eq, lt, or, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { channelThreadState, integrationEvents } from "@/db/schema";
import type { InboundChannelMessage } from "./registry.ts";

/**
 * The `provider` value channel events are logged under.
 *
 * Distinct from the plain `whatsapp` rows the Inbox integration writes, so the
 * two drains cannot claim each other's work. They are different pipelines that
 * happen to share a table.
 */
export const CHANNEL_EVENT_PROVIDER = "whatsapp_agent";

/** How long a claimed-but-unfinished event waits before another worker may retry it. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/** How long the tail of a truncated answer stays available to `MORE`. */
const OVERFLOW_TTL_MS = 30 * 60 * 1000;

/**
 * Record an inbound message for the worker to pick up.
 *
 * Idempotent on the provider's message id via the table's own
 * `(provider, external_event_id)` unique index. Meta redelivers; a redelivery
 * must produce no second row and therefore no second reply.
 *
 * Returns whether this was a new message — the caller uses it only for
 * counters, never to change the response, which is always a fast ack.
 */
export async function enqueueInbound(message: InboundChannelMessage, organizationId: string | null): Promise<boolean> {
  const inserted = await getDb()
    .insert(integrationEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      provider: CHANNEL_EVENT_PROVIDER,
      externalEventId: `${message.channel}:${message.externalMessageId}`,
      eventType: "inbound_message",
      payloadJson: JSON.stringify({ ...message, sentAt: message.sentAt.toISOString() }),
      status: "received",
      receivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: integrationEvents.id });

  return inserted.length > 0;
}

export interface ClaimedEvent {
  id: string;
  message: InboundChannelMessage;
  organizationId: string | null;
}

/**
 * Claim up to `limit` events for processing.
 *
 * The claim is a status transition guarded by the previous status, so two
 * workers racing on the same row produce exactly one winner — the loser's
 * update matches nothing. That is the whole concurrency control, and it needs
 * no lock table because SQLite gives us the compare-and-set for free.
 *
 * Events claimed more than `CLAIM_TIMEOUT_MS` ago are eligible again: a worker
 * that died mid-run must not strand the message it was holding.
 */
export async function claimInboundEvents(limit = 10): Promise<ClaimedEvent[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS);

  const candidates = await db
    .select({ id: integrationEvents.id, payloadJson: integrationEvents.payloadJson, organizationId: integrationEvents.organizationId })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.provider, CHANNEL_EVENT_PROVIDER),
        or(
          eq(integrationEvents.status, "received"),
          and(eq(integrationEvents.status, "processing"), or(isNull(integrationEvents.processedAt), lt(integrationEvents.processedAt, cutoff))),
        ),
      ),
    )
    .orderBy(asc(integrationEvents.receivedAt))
    .limit(limit);

  const claimed: ClaimedEvent[] = [];
  for (const candidate of candidates) {
    const won = await db
      .update(integrationEvents)
      .set({ status: "processing", processedAt: new Date() })
      .where(and(eq(integrationEvents.id, candidate.id), or(eq(integrationEvents.status, "received"), eq(integrationEvents.status, "processing"))))
      .returning({ id: integrationEvents.id });
    if (won.length === 0) continue;

    try {
      const parsed = JSON.parse(candidate.payloadJson) as InboundChannelMessage & { sentAt: string };
      claimed.push({
        id: candidate.id,
        organizationId: candidate.organizationId,
        message: { ...parsed, sentAt: new Date(parsed.sentAt) },
      });
    } catch {
      // A row we cannot parse will never become parseable. Park it rather than
      // letting it be re-claimed forever at the head of the queue.
      await markEvent(candidate.id, "malformed");
    }
  }

  return claimed;
}

/** Close out an event. `processed` on success, `failed` when the run threw. */
export async function markEvent(id: string, status: "processed" | "failed" | "malformed"): Promise<void> {
  await getDb().update(integrationEvents).set({ status, processedAt: new Date() }).where(eq(integrationEvents.id, id));
}

/** Hold the tail of a truncated answer so `MORE` can return it without a second model call. */
export async function storeOverflow(channelIdentityId: string, organizationId: string, overflow: string | null): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(channelThreadState)
    .values({
      channelIdentityId,
      organizationId,
      overflow,
      overflowExpiresAt: overflow ? new Date(now.getTime() + OVERFLOW_TTL_MS) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: channelThreadState.channelIdentityId,
      set: { overflow, overflowExpiresAt: overflow ? new Date(now.getTime() + OVERFLOW_TTL_MS) : null, updatedAt: now },
    });
}

/**
 * The held tail, if it has not expired.
 *
 * Expiry is checked here rather than swept, because a stale tail is only
 * wrong at the moment somebody asks for it — and answering `MORE` with the
 * remainder of a question from yesterday is worse than answering nothing.
 */
export async function readOverflow(channelIdentityId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ overflow: channelThreadState.overflow, expiresAt: channelThreadState.overflowExpiresAt })
    .from(channelThreadState)
    .where(eq(channelThreadState.channelIdentityId, channelIdentityId))
    .limit(1);
  if (!row?.overflow || !row.expiresAt) return null;
  return row.expiresAt.getTime() > Date.now() ? row.overflow : null;
}
