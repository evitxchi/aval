/**
 * The shapes and formatting of a proposed action, free of storage imports.
 *
 * Split from `actions.ts` for the same reason `identity-types.ts` is split
 * from `identity.ts`: `db/index.ts` resolves the D1 binding at module scope,
 * so anything importing it cannot be loaded by a plain `node --test`. The
 * rules worth testing hardest here — that a malformed button payload is
 * refused, that a preview masks a phone number, that an irreversible action
 * offers no undo — are all pure, and they belong in the fast lane.
 */

import { copy, type ChannelLocale } from "./copy.ts";
import type { ChannelButton } from "./registry.ts";

/** Fifteen minutes, as the brief specifies. Long enough to think, short enough that a stale proposal cannot be confirmed into a changed world. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

/** How long a reversible write can be undone. */
export const UNDO_TTL_MS = 10 * 60 * 1000;

export interface RecipientPreview {
  /** Who this goes to, as the operator would recognise them. */
  label: string;
  /** The resolved destination. Never shown in full in a preview — see `previewText`. */
  destination: string;
  /** Per-recipient detail, e.g. the amount owed. */
  detail?: string;
}

export interface PendingAction {
  id: string;
  organizationId: string;
  channelIdentityId: string;
  tool: string;
  args: Record<string, unknown>;
  recipients: RecipientPreview[];
  summary: string;
  expiresAt: Date;
}

export type UndoOutcome = "reverted" | "expired" | "not_reversible" | "unknown";

/**
 * The buttons on a proposal.
 *
 * "See all N" comes first when there is a batch, because reviewing who is
 * about to be messaged is the thing the operator most needs to do and least
 * wants to have to think to ask for.
 */
export function confirmButtons(actionId: string, recipientCount: number, locale: ChannelLocale): ChannelButton[] {
  const buttons: ChannelButton[] = [];
  if (recipientCount > 1) {
    buttons.push({ label: `${copy(locale, "buttonSeeAll")} ${recipientCount}`, id: `action:list:${actionId}` });
  }
  buttons.push({ label: copy(locale, "buttonSend"), id: `action:confirm:${actionId}` });
  buttons.push({ label: copy(locale, "buttonNotNow"), id: `action:cancel:${actionId}` });
  return buttons;
}

/**
 * Parse a button payload into an intent.
 *
 * Strict to the point of rigidity, because this is the one place a value from
 * the network chooses what code runs. A uuid shape and a bounded integer are
 * the entire accepted vocabulary; everything else returns null and is dropped.
 * An id that parses still has to match a stored row that belongs to the
 * sender's own identity — see `loadPendingAction`.
 */
export function parseActionPayload(
  payload: string,
): { intent: "confirm" | "cancel" | "list" | "drop" | "undo"; id: string; index?: number } | null {
  const match = /^action:(confirm|cancel|list|undo):([0-9a-f-]{36})$/.exec(payload);
  if (match) return { intent: match[1] as "confirm" | "cancel" | "list" | "undo", id: match[2] };

  // Dropping one recipient from a batch carries an index. Bounds are checked
  // against the actual recipient list by the caller, not here — this only
  // constrains it to a small integer so it cannot be a payload of its own.
  const drop = /^action:drop:([0-9a-f-]{36}):(\d{1,3})$/.exec(payload);
  if (drop) return { intent: "drop", id: drop[1], index: Number(drop[2]) };

  return null;
}

/**
 * The per-recipient preview.
 *
 * Destinations are masked. The operator already knows who these people are —
 * the label is what identifies them — and printing full phone numbers into a
 * chat that may be screenshotted or forwarded adds exposure and nothing else.
 * The last four digits stay so two residents with the same first name are
 * still distinguishable.
 */
export function previewText(action: PendingAction, locale: ChannelLocale): string {
  const lines = action.recipients.map((recipient, index) => {
    const masked = recipient.destination.length > 4 ? `…${recipient.destination.slice(-4)}` : "";
    return `${index + 1}. ${recipient.label} ${masked}${recipient.detail ? ` — ${recipient.detail}` : ""}`;
  });
  const header = locale === "es-mx" ? "*Se enviará a:*" : "*Will send to:*";
  return `${header}\n${lines.join("\n")}`;
}

/**
 * The reply for a completed write.
 *
 * An undo button appears only when an undo would actually work. A sent
 * WhatsApp message cannot be unsent by anyone, so that case says so plainly
 * rather than offering a button that would fail — the brief forbids the
 * alternative, and it is right to: an undo that lies is worse than no undo,
 * because the operator stops looking for another remedy.
 */
export function completionMessage(
  reversible: boolean,
  actionId: string,
  locale: ChannelLocale,
): { text: string; buttons: ChannelButton[] } {
  if (!reversible) return { text: copy(locale, "actionIrreversible"), buttons: [] };
  return {
    text: copy(locale, "actionDone"),
    buttons: [{ label: copy(locale, "buttonUndo"), id: `action:undo:${actionId}` }],
  };
}
