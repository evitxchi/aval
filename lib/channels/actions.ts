/**
 * Propose, preview, confirm, execute, undo.
 *
 * Nothing that writes runs on first mention. "Send reminders to everyone late
 * at Riverside" produces a *proposal* — a row with the resolved arguments and
 * a fifteen-minute expiry — and a reply with buttons. Only a matching
 * confirmation executes it.
 *
 * The reason to store the resolved arguments server-side rather than encode
 * them in the button payload is worth being explicit about. The payload
 * arrives over the network and is attacker-controlled; if it carried
 * recipients or amounts, a crafted reply could change what runs. Carrying only
 * an opaque id means a crafted payload can at most *select* an action the
 * backend already composed and already gated, and cannot compose one.
 *
 * Batches expand. "Send reminders to everyone late" is three separate messages
 * to three real people, and the brief is right that one misdirected
 * delinquency notice ends a customer relationship — so the operator can list
 * the recipients and drop any of them before confirming.
 */

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { actionCheckpoints, channelPendingActions } from "@/db/schema";
import {
  PENDING_TTL_MS,
  UNDO_TTL_MS,
  confirmButtons,
  type PendingAction,
  type RecipientPreview,
  type UndoOutcome,
} from "./action-format.ts";
import type { ChannelButton } from "./registry.ts";

// One import site for the whole action vocabulary: callers reach for
// `actions.ts` and get the formatting helpers too, rather than having to know
// which half of the split a given function landed in.
export * from "./action-format.ts";

/**
 * Store a proposal and return the buttons that resolve it.
 *
 * The id is a fresh uuid rather than anything derived from the content: two
 * identical proposals a minute apart are two decisions, and collapsing them
 * onto one id would let a confirmation for the first execute the second.
 */
export async function proposeAction(input: {
  organizationId: string;
  channelIdentityId: string;
  tool: string;
  args: Record<string, unknown>;
  recipients?: RecipientPreview[];
  summary: string;
  now?: Date;
}): Promise<{ action: PendingAction; buttons: ChannelButton[] }> {
  const now = input.now ?? new Date();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS);
  const recipients = input.recipients ?? [];

  await getDb().insert(channelPendingActions).values({
    id,
    organizationId: input.organizationId,
    channelIdentityId: input.channelIdentityId,
    tool: input.tool,
    argsJson: JSON.stringify(input.args),
    recipientsJson: JSON.stringify(recipients),
    summary: input.summary,
    status: "pending",
    expiresAt,
    createdAt: now,
  });

  return {
    action: {
      id,
      organizationId: input.organizationId,
      channelIdentityId: input.channelIdentityId,
      tool: input.tool,
      args: input.args,
      recipients,
      summary: input.summary,
      expiresAt,
    },
    buttons: confirmButtons(id, recipients.length, "en"),
  };
}

/**
 * Load a pending action, if it is still pending and still this identity's.
 *
 * The `channelIdentityId` predicate is the authorisation check, not a filter:
 * an action id is a uuid, but guessing is not the only way to obtain one — it
 * appears in a button payload, which is in a message, which could be
 * forwarded. Binding the action to the identity that proposed it means a
 * forwarded button is inert in anyone else's hands.
 */
export async function loadPendingAction(
  id: string,
  channelIdentityId: string,
  now = new Date(),
): Promise<PendingAction | null> {
  const [row] = await getDb()
    .select()
    .from(channelPendingActions)
    .where(and(eq(channelPendingActions.id, id), eq(channelPendingActions.channelIdentityId, channelIdentityId)))
    .limit(1);

  if (!row || row.status !== "pending") return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    channelIdentityId: row.channelIdentityId,
    tool: row.tool,
    args: safeJson(row.argsJson) as Record<string, unknown>,
    recipients: (safeJson(row.recipientsJson) as RecipientPreview[]) ?? [],
    summary: row.summary,
    expiresAt: row.expiresAt,
  };
}

/**
 * Claim an action for execution.
 *
 * The status predicate makes this a compare-and-set: two taps on the same
 * button — which happens, because a slow reply looks like a failed one —
 * produce exactly one execution.
 */
export async function claimAction(id: string, channelIdentityId: string, now = new Date()): Promise<boolean> {
  const claimed = await getDb()
    .update(channelPendingActions)
    .set({ status: "confirmed", resolvedAt: now })
    .where(
      and(
        eq(channelPendingActions.id, id),
        eq(channelPendingActions.channelIdentityId, channelIdentityId),
        eq(channelPendingActions.status, "pending"),
      ),
    )
    .returning({ id: channelPendingActions.id });
  return claimed.length > 0;
}

export async function cancelAction(id: string, channelIdentityId: string, now = new Date()): Promise<boolean> {
  const cancelled = await getDb()
    .update(channelPendingActions)
    .set({ status: "cancelled", resolvedAt: now })
    .where(
      and(
        eq(channelPendingActions.id, id),
        eq(channelPendingActions.channelIdentityId, channelIdentityId),
        eq(channelPendingActions.status, "pending"),
      ),
    )
    .returning({ id: channelPendingActions.id });
  return cancelled.length > 0;
}

/** Remove one recipient from a batch before it runs. */
export async function dropRecipient(
  id: string,
  channelIdentityId: string,
  index: number,
): Promise<RecipientPreview[] | null> {
  const action = await loadPendingAction(id, channelIdentityId);
  if (!action) return null;
  if (!Number.isInteger(index) || index < 0 || index >= action.recipients.length) return action.recipients;

  const remaining = action.recipients.filter((_, position) => position !== index);
  await getDb()
    .update(channelPendingActions)
    .set({ recipientsJson: JSON.stringify(remaining) })
    .where(and(eq(channelPendingActions.id, id), eq(channelPendingActions.organizationId, action.organizationId)));
  return remaining;
}

/**
 * Record what a write looked like before it happened.
 *
 * `reversible` is a claim about the world, not about our code. A ledger row we
 * wrote can be restored; a WhatsApp message that has left cannot be unsent by
 * anyone. Marking a send `reversible: false` and saying so is honest; offering
 * an undo that would fail is not, and the brief is right to forbid it.
 */
export async function recordCheckpoint(input: {
  organizationId: string;
  agentActionId: string;
  tool: string;
  before: unknown;
  reversible: boolean;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const id = crypto.randomUUID();
  await getDb()
    .insert(actionCheckpoints)
    .values({
      id,
      organizationId: input.organizationId,
      agentActionId: input.agentActionId,
      tool: input.tool,
      before: JSON.stringify(input.before ?? null),
      reversible: input.reversible,
      expiresAt: new Date(now.getTime() + UNDO_TTL_MS),
      createdAt: now,
    })
    .onConflictDoNothing();
  return id;
}

/**
 * Revert a write, if it can be reverted.
 *
 * Returns the stored `before` state for the caller to apply — this module owns
 * the bookkeeping, not the domain knowledge of how to put a lease back. A
 * single function that knew how to reverse every tool would be a second
 * implementation of every tool.
 */
export async function undoAction(
  organizationId: string,
  agentActionId: string,
  now = new Date(),
): Promise<{ outcome: UndoOutcome; before?: unknown }> {
  const [row] = await getDb()
    .select()
    .from(actionCheckpoints)
    .where(
      and(eq(actionCheckpoints.organizationId, organizationId), eq(actionCheckpoints.agentActionId, agentActionId)),
    )
    .limit(1);

  if (!row) return { outcome: "unknown" };
  if (!row.reversible) return { outcome: "not_reversible" };
  if (row.revertedAt) return { outcome: "reverted", before: safeJson(row.before) };
  if (row.expiresAt.getTime() <= now.getTime()) return { outcome: "expired" };

  const claimed = await getDb()
    .update(actionCheckpoints)
    .set({ revertedAt: now })
    .where(and(eq(actionCheckpoints.id, row.id), eq(actionCheckpoints.organizationId, organizationId)))
    .returning({ id: actionCheckpoints.id });
  if (claimed.length === 0) return { outcome: "unknown" };

  return { outcome: "reverted", before: safeJson(row.before) };
}

/** Mark proposals nobody acted on. Run from the cron so the table does not grow forever. */
export async function expirePendingActions(now = new Date()): Promise<number> {
  // cross-tenant-sweep: a maintenance pass over every tenant's expired
  // proposals. It reads no tenant data and returns only ids of rows whose TTL
  // has already passed, so there is nothing here to leak between orgs — and
  // scoping it per-org would mean enumerating organizations on every cron tick
  // to do the same work in more queries.
  const expired = await getDb()
    .update(channelPendingActions)
    .set({ status: "expired", resolvedAt: now })
    .where(and(eq(channelPendingActions.status, "pending"), lt(channelPendingActions.expiresAt, now)))
    .returning({ id: channelPendingActions.id });
  return expired.length;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
