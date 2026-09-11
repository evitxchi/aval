/**
 * Identity resolution for inbound channel messages — the security boundary.
 *
 * Everything downstream of this file trusts what it returns. An inbound
 * WhatsApp message carries exactly one thing worth anything: the sender's
 * phone number, asserted by Meta and verified by the webhook's HMAC. Every
 * other field — the display name, the message body, anything a model later
 * extracts from it — is attacker-controlled text.
 *
 * So `organizationId` and `role` are computed here, from a database lookup on
 * the normalised number, and are never accepted from anywhere else. The model
 * is not given an org argument to fill in; it is given tools that already know
 * which org they are running in. That is a structural defence rather than an
 * instruction, which is the only kind that survives a prompt injection.
 *
 * The other half of the boundary is what happens on a miss: an unknown number
 * gets one canned reply and **no model call**. Not a model call that declines —
 * no model call. An unlinked number must not be able to spend our tokens or
 * reach a tool, and "the model was told to refuse" is not the same guarantee.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { channelIdentities } from "@/db/schema";
import { normalisePhone } from "./phone.ts";
import { isChannelRole, toolNamesForRole } from "./roles.ts";
import type { ChannelId, InboundIdentity } from "./identity-types.ts";

export type { ChannelId, InboundIdentity } from "./identity-types.ts";
export { sessionFor } from "./identity-types.ts";

/**
 * Resolve an inbound sender to an identity, or `null`.
 *
 * `null` has exactly one meaning: **do not call the model.** It covers an
 * unparseable number, an unknown number, and a number whose row exists but was
 * never verified. Callers must treat all three the same way, because from the
 * outside they are the same thing — someone we have no established
 * relationship with.
 */
export async function resolveInbound(phone: unknown, channel: ChannelId): Promise<InboundIdentity | null> {
  const externalId = normalisePhone(phone);
  if (!externalId) return null;

  const [row] = await getDb()
    .select()
    .from(channelIdentities)
    .where(and(eq(channelIdentities.channel, channel), eq(channelIdentities.externalId, externalId)))
    .limit(1);

  if (!row) return null;
  // An unverified row is a half-finished link, not a relationship. Treating it
  // as one would mean a row written by any future code path that forgets to
  // set `verifiedAt` silently becomes a live credential.
  if (!row.verifiedAt) return null;

  // A role we do not recognise is a row written by something we no longer
  // understand — a rename, a bad migration, a hand-edited record. Failing
  // closed costs one person one reply; guessing a role costs whatever that
  // role can reach.
  if (!isChannelRole(row.role)) return null;

  return {
    channelIdentityId: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    contactId: row.contactId,
    channel,
    externalId,
    role: row.role,
    locale: row.locale,
    toolNames: toolNamesForRole(row.role),
  };
}
