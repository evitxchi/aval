/**
 * The channel's audit trail.
 *
 * Written into the existing hash-chained log (`lib/audit/`), not a new table.
 * That is the point of the brief's rule about the AI being a first-class actor:
 * an action taken by the agent over WhatsApp and one taken by a coordinator in
 * the dashboard should differ in the *actor* field and nowhere else. Two
 * separate logs would make "what happened to this lease" a question requiring
 * two queries and a merge, which is how discrepancies become invisible.
 *
 * Everything stored is a digest plus a non-identifying count, which is the
 * chain's existing contract and the reason it can be retained indefinitely
 * under the LFPDPPP without becoming a second copy of the resident database.
 * The message text never enters it. Neither does the phone number.
 */

import { appendAuditEvents } from "@/lib/audit/log";
import { digestPayload } from "@/lib/audit/chain";
import type { AuditEvent } from "@/lib/audit/chain";
import { phoneFingerprint } from "./scrub.ts";
import type { EscalationMatch } from "./escalation.ts";
import type { ChannelRole } from "./roles.ts";

/**
 * How the actor is named in the trail.
 *
 * A channel action carries three facts a dashboard action does not: that it
 * came from a messaging surface, which role, and which identity. The identity
 * is its row id, never the phone number — the id is stable, non-identifying on
 * its own, and resolvable by someone with database access who already has the
 * number anyway.
 */
export function channelActor(input: { role: ChannelRole; channelIdentityId: string; channel: string }): string {
  return `whatsapp:${input.channel}:${input.role}:${input.channelIdentityId}`;
}

/** A handset was linked to a workspace. Who can reach this tenant's data just changed. */
export async function auditLink(input: {
  organizationId: string;
  channelIdentityId: string;
  channel: string;
  role: ChannelRole;
  externalId: string;
}): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_linked",
    label: channelActor(input),
    // The fingerprint, not the number: enough to correlate a support question
    // to a row, not enough to dial.
    payloadDigest: await digestPayload({ role: input.role, phone: phoneFingerprint(input.externalId) }),
    count: 1,
  });
}

/** A write was proposed. Recorded before it is confirmed, so an abandoned proposal is still visible. */
export async function auditProposal(input: {
  organizationId: string;
  actor: string;
  tool: string;
  args: Record<string, unknown>;
  recipientCount: number;
}): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_action_proposed",
    label: `${input.actor}|${input.tool}`,
    payloadDigest: await digestPayload(input.args),
    count: input.recipientCount,
  });
}

/**
 * A write ran.
 *
 * `count` is the number of recipients it actually reached, which may be fewer
 * than were proposed — the operator can drop names from a batch before
 * confirming, and the trail should show what happened rather than what was
 * offered.
 */
export async function auditConfirmed(input: {
  organizationId: string;
  actor: string;
  tool: string;
  args: Record<string, unknown>;
  recipientCount: number;
}): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_action_confirmed",
    label: `${input.actor}|${input.tool}`,
    payloadDigest: await digestPayload(input.args),
    count: input.recipientCount,
  });
}

export async function auditCancelled(input: { organizationId: string; actor: string; tool: string }): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_action_cancelled",
    label: `${input.actor}|${input.tool}`,
    payloadDigest: await digestPayload({ tool: input.tool }),
    count: 0,
  });
}

export async function auditUndone(input: { organizationId: string; actor: string; tool: string; actionId: string }): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_action_undone",
    label: `${input.actor}|${input.tool}`,
    payloadDigest: await digestPayload({ actionId: input.actionId }),
    count: 1,
  });
}

/**
 * A message was classified as needing a person.
 *
 * The category and the term that matched are recorded; the message is not. The
 * category is the operationally useful fact — "we had four habitability
 * escalations this week" is a question worth answering — and the text is the
 * most sensitive thing in the system.
 */
export async function auditEscalation(input: {
  organizationId: string;
  actor: string;
  match: EscalationMatch;
}): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_escalated",
    label: `${input.actor}|${input.match.category}`,
    payloadDigest: await digestPayload({ category: input.match.category, matched: input.match.matched, severity: input.match.severity }),
    count: 1,
  });
}

/** A conversation was handed to a human. An audited event in its own right, as the brief requires. */
export async function auditHandoff(input: { organizationId: string; actor: string; reason: string }): Promise<void> {
  await append(input.organizationId, {
    kind: "channel_handoff",
    label: `${input.actor}|${input.reason}`,
    payloadDigest: await digestPayload({ reason: input.reason }),
    count: 1,
  });
}

/**
 * Appending never fails the thing it is recording.
 *
 * The same posture `lib/audit/log.ts` documents for answers, and for the same
 * reason: this is a bookkeeping trail, not the product. A workspace whose
 * audit write fails should still get its reply. A missing row shows up later
 * as a sequence gap, which is the honest outcome — the chain says it cannot
 * vouch for that stretch rather than pretending it can.
 */
async function append(organizationId: string, event: AuditEvent): Promise<void> {
  try {
    await appendAuditEvents(organizationId, [event]);
  } catch (error) {
    console.error(JSON.stringify({ event: "channel_audit_failed", kind: event.kind, error: error instanceof Error ? error.message : "unknown" }));
  }
}
