/**
 * The durable outbound path for channel replies.
 *
 * Every send is a row first and an HTTP call second. A failed delivery is
 * therefore something to retry rather than a message that quietly never
 * arrived — which matters more here than on the dashboard, because nobody is
 * watching a WhatsApp reply fail.
 *
 * This writes to `communication_deliveries`, the table `lib/communications/store.ts`
 * already uses. It does **not** call that module's `deliver()`, for one reason:
 * `dispatchMessage` sends `type: "text"` only, and an answer without its reply
 * buttons has lost the thing that makes the channel discoverable. So the same
 * ledger, a different dispatcher — not a second ledger, which the brief
 * forbids and which would leave two incomplete pictures of what was sent.
 *
 * The 24-hour window check is duplicated from `deliver()` on purpose. It is a
 * Meta policy boundary, and a second client reaching the same API has to
 * respect it independently rather than inheriting it by accident.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { communicationDeliveries, conversations, messages } from "@/db/schema";
import { digestPayload } from "@/lib/audit/chain";
import { connectedAccount } from "@/lib/communications/connection";
import { getChannelAdapter, type ChannelButton } from "./registry.ts";
import type { ChannelId } from "./identity-types.ts";

export interface ChannelSendResult {
  operationId: string;
  providerId: string | null;
  status: "accepted" | "failed" | "duplicate" | "outside_window";
  error?: string;
}

/**
 * Whether a free-form reply is still allowed on this thread.
 *
 * Outside the window Meta accepts only pre-approved templates. Returning a
 * status rather than throwing lets the caller fall back to a template instead
 * of losing the message — see docs/WA_TEMPLATES.md.
 */
export async function withinSessionWindow(organizationId: string, channel: ChannelId, externalId: string): Promise<boolean> {
  const adapter = getChannelAdapter(channel);
  const hours = adapter?.capabilities.sessionWindowHours;
  if (!hours) return true;

  const db = getDb();
  // `conversations.externalThreadId` stores WhatsApp's own spelling, which has
  // no leading `+`.
  const threadId = externalId.replace(/^\+/, "");
  const [thread] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.channel, channel), eq(conversations.externalThreadId, threadId)))
    .limit(1);
  if (!thread) return false;

  const [lastInbound] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, thread.id), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return Boolean(lastInbound && lastInbound.createdAt.getTime() >= Date.now() - hours * 3600_000);
}

/**
 * Send a reply, recording it before it leaves.
 *
 * `requestKey` is the idempotency key and must be derived from the thing being
 * answered — the inbound message id, or the pending action id — never from a
 * clock or a random value. A retried worker run with the same key sends
 * nothing and reports `duplicate`; that is the whole defence against a crash
 * mid-send turning into two messages to a resident.
 */
export async function sendChannelMessage(input: {
  organizationId: string;
  channel: ChannelId;
  to: string;
  body: string;
  buttons?: ChannelButton[];
  requestKey: string;
  /** Skip the session-window check for a template send, which is allowed outside it. */
  isTemplate?: boolean;
}): Promise<ChannelSendResult> {
  const adapter = getChannelAdapter(input.channel);
  if (!adapter) throw new Error(`No adapter registered for channel ${input.channel}.`);
  if (!input.requestKey || input.requestKey.length > 200) throw new Error("A stable operation key is required.");

  if (!input.isTemplate && !(await withinSessionWindow(input.organizationId, input.channel, input.to))) {
    return { operationId: "", providerId: null, status: "outside_window" };
  }

  const { connection, credentials, config } = await connectedAccount(input.organizationId, input.channel);
  const db = getDb();
  const now = new Date();
  const id = crypto.randomUUID();
  // Buttons are part of the payload identity: the same text with different
  // buttons is a different message, and conflating them would let a retry
  // silently drop the buttons.
  const payloadDigest = await digestPayload({ body: input.body, buttons: input.buttons ?? [], to: input.to, channel: input.channel });

  const inserted = await db
    .insert(communicationDeliveries)
    .values({
      id,
      organizationId: input.organizationId,
      connectionId: connection.id,
      requestKey: input.requestKey,
      payloadDigest,
      kind: "message",
      destination: input.to,
      body: input.body,
      status: "sending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: communicationDeliveries.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select()
      .from(communicationDeliveries)
      .where(and(eq(communicationDeliveries.organizationId, input.organizationId), eq(communicationDeliveries.requestKey, input.requestKey)))
      .limit(1);
    // A key bound to different content is a bug in the caller, not a retry.
    // Sending anyway would mean one key covering two messages, which defeats
    // the point of having one.
    if (!existing || existing.payloadDigest !== payloadDigest) {
      throw new Error("This operation key is already bound to a different message.");
    }
    return { operationId: existing.id, providerId: existing.providerId, status: "duplicate" };
  }

  const receipt = await adapter.send(
    { channel: input.channel, to: input.to, body: input.body, buttons: input.buttons },
    { credentials, config, operationId: id },
  );

  await db
    .update(communicationDeliveries)
    .set({ status: receipt.status, providerId: receipt.providerId, error: receipt.error ?? null, updatedAt: new Date() })
    .where(and(eq(communicationDeliveries.id, id), eq(communicationDeliveries.status, "sending")));

  return { operationId: id, providerId: receipt.providerId, status: receipt.status, error: receipt.error };
}
