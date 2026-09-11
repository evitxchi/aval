/**
 * Linking a handset to a workspace.
 *
 * The dashboard issues a code, the operator sends it from the phone they want
 * linked, and the webhook matches it. That round trip is what proves the
 * person holding the handset is the person holding the dashboard session.
 *
 * **Matching on the phone number alone is forbidden and there is no fallback
 * to it.** A phone number is not a secret: it appears on lease paperwork, in
 * vendor emails, and in the payload of every message the operator has ever
 * sent. If knowing a number were sufficient to link it, knowing an operator's
 * number would be sufficient to open their workspace. The code is the only
 * thing that establishes the connection, and an expired or consumed one gets a
 * plain refusal rather than a second chance.
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { channelIdentities, channelLinkCodes, organizations } from "@/db/schema";
import { normalisePhone } from "./phone";
import { isChannelRole, type ChannelRole } from "./roles";
import type { ChannelId } from "./identity";

/**
 * Fifteen minutes. Long enough to walk to your desk, short enough that a code
 * screenshotted into a group chat has usually already died.
 */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Crockford's base32 alphabet minus its ambiguous characters: no I, L, O, U.
 * The code is read off a screen and typed into a phone, and `0`/`O` confusion
 * turns a security refusal into a support ticket.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

/**
 * The prefix that makes a link code recognisable in a message body.
 *
 * The webhook must decide whether an inbound message is a link attempt
 * *before* it has an identity to attribute it to, so the marker has to live in
 * the text. It is not a secret and is not treated as one — it only routes.
 */
export const LINK_PREFIX = "AVAL-LINK";

/** A code with enough entropy that guessing is not a strategy. */
function generateCode(): string {
  // 8 characters from a 32-symbol alphabet is 40 bits. Combined with a
  // fifteen-minute TTL and single use, brute force is not a realistic path.
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export interface IssuedLinkCode {
  code: string;
  /** The full message the operator sends, prefix included. */
  message: string;
  /** A `wa.me` deep link with that message prefilled. */
  deepLink: string;
  expiresAt: Date;
}

/**
 * Issue a code for a workspace member.
 *
 * `role` and `organizationId` come from the caller's authenticated dashboard
 * session, never from a form field — a code that let its requester choose the
 * role it grants would be a privilege-escalation form with extra steps.
 */
export async function issueLinkCode(input: {
  organizationId: string;
  userId: string;
  role: ChannelRole;
  locale: string;
  /** The business number the operator will message, in E.164. */
  businessNumber: string;
  now?: Date;
}): Promise<IssuedLinkCode> {
  if (!isChannelRole(input.role)) throw new Error("Unknown role.");

  const now = input.now ?? new Date();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);

  await getDb().insert(channelLinkCodes).values({
    code,
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    locale: input.locale,
    expiresAt,
    createdAt: now,
  });

  const message = `${LINK_PREFIX} ${code}`;
  const destination = normalisePhone(input.businessNumber);
  if (!destination) throw new Error("The WhatsApp business number is not a valid phone number.");

  return {
    code,
    message,
    // wa.me wants the number without its leading `+`.
    deepLink: `https://wa.me/${destination.slice(1)}?text=${encodeURIComponent(message)}`,
    expiresAt,
  };
}

/**
 * Pull a link code out of an inbound message body.
 *
 * Tolerant about how the operator sent it — case, spacing, and a stray
 * punctuation mark from a phone keyboard all survive — and strict about what
 * counts as a code. Returns null when the message is not a link attempt at
 * all, which is the common case and must stay cheap.
 */
export function extractLinkCode(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const match = body.toUpperCase().match(new RegExp(`${LINK_PREFIX}[\\s:-]*([${ALPHABET}]{${CODE_LENGTH}})`));
  return match ? match[1] : null;
}

export type LinkOutcome =
  | { status: "linked"; organizationId: string; organizationName: string; role: ChannelRole; locale: string; channelIdentityId: string }
  | { status: "expired" }
  | { status: "consumed" }
  | { status: "unknown_code" }
  | { status: "invalid_number" }
  | { status: "already_linked_elsewhere" };

/**
 * Consume a code and write the identity.
 *
 * Every non-success outcome is named separately rather than collapsed into one
 * failure, because the reply text differs and a person who mistyped a code
 * deserves to be told that rather than being told nothing. None of the names
 * leak anything: they describe the state of a code the sender already had.
 */
export async function consumeLinkCode(input: {
  code: string;
  phone: unknown;
  channel: ChannelId;
  now?: Date;
}): Promise<LinkOutcome> {
  const now = input.now ?? new Date();
  const externalId = normalisePhone(input.phone);
  if (!externalId) return { status: "invalid_number" };

  const db = getDb();
  const [row] = await db.select().from(channelLinkCodes).where(eq(channelLinkCodes.code, input.code)).limit(1);
  if (!row) return { status: "unknown_code" };
  if (row.consumedAt) return { status: "consumed" };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
  if (!isChannelRole(row.role)) return { status: "unknown_code" };

  // One number links to one workspace. A number already pointing somewhere
  // else is refused rather than repointed: silently moving an identity between
  // orgs on receipt of a code is a way to hijack a number that is still in
  // someone's contact list.
  const [existing] = await db
    .select({ id: channelIdentities.id, organizationId: channelIdentities.organizationId })
    .from(channelIdentities)
    .where(and(eq(channelIdentities.channel, input.channel), eq(channelIdentities.externalId, externalId)))
    .limit(1);
  if (existing && existing.organizationId !== row.organizationId) return { status: "already_linked_elsewhere" };

  // Claim the code before writing the identity. The `isNull(consumedAt)`
  // predicate is the concurrency control: two messages carrying the same code
  // race here, and exactly one update reports a change.
  const claimed = await db
    .update(channelLinkCodes)
    .set({ consumedAt: now, consumedByExternalId: externalId })
    .where(and(eq(channelLinkCodes.code, input.code), isNull(channelLinkCodes.consumedAt)))
    .returning({ code: channelLinkCodes.code });
  if (claimed.length === 0) return { status: "consumed" };

  const channelIdentityId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await db
      .update(channelIdentities)
      .set({ userId: row.userId, role: row.role, locale: row.locale, verifiedAt: now })
      .where(eq(channelIdentities.id, existing.id));
  } else {
    await db.insert(channelIdentities).values({
      id: channelIdentityId,
      organizationId: row.organizationId,
      userId: row.userId,
      contactId: null,
      channel: input.channel,
      externalId,
      role: row.role,
      locale: row.locale,
      verifiedAt: now,
      createdAt: now,
    });
  }

  const [organization] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, row.organizationId))
    .limit(1);

  return {
    status: "linked",
    organizationId: row.organizationId,
    organizationName: organization?.name ?? "your workspace",
    role: row.role,
    locale: row.locale,
    channelIdentityId,
  };
}
