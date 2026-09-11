import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { channelIdentities, integrationConnections } from "@/db/schema";
import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { decryptSecret } from "@/lib/integrations/crypto";
import { issueLinkCode } from "@/lib/channels/linking";
import { isChannelRole, type ChannelRole } from "@/lib/channels/roles";
import { canInvite } from "@/lib/organizations/roles";
import { phoneFingerprint, scrubError } from "@/lib/channels/scrub";
import { env } from "cloudflare:workers";

/**
 * Issue a code that links a handset to this workspace.
 *
 * The two facts that decide what the code grants — which organization, and
 * which role — come from the caller's authenticated session, never from the
 * request body. A code whose requester could name its own role would be a
 * privilege-escalation form with extra steps, and a code whose requester could
 * name its own organization would be worse than that.
 *
 * The body carries exactly one thing: which role to grant *someone else*, and
 * only an owner may send it, because issuing one grants standing access to
 * everything the workspace holds — the same reason `canInvite` restricts
 * invitations to owners.
 */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  // The shared signed-out workspace must never issue a credential: every guest
  // is the same subject, so a code issued by one would open the workspace to
  // all of them, permanently, from a phone.
  if (isGuestIdentity(identity)) {
    return Response.json({ error: "Sign in to link a phone number." }, { status: 403 });
  }
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as { role?: string };

  // Linking someone else in is an owner's decision. A member linking their own
  // handset is the common case and is permitted at their existing role.
  const requestedRole = body.role;
  let role: ChannelRole = identity.role;
  if (requestedRole !== undefined) {
    if (!canInvite(identity.role)) {
      return Response.json({ error: "Only an owner can issue a code for another role." }, { status: 403 });
    }
    if (!isChannelRole(requestedRole)) {
      return Response.json({ error: "Unknown role." }, { status: 400 });
    }
    role = requestedRole;
  }

  // The number the operator will message. Read from the org's own connected
  // WhatsApp credentials rather than from the request, so a code can never be
  // pointed at a number this workspace does not control.
  const businessNumber = await connectedBusinessNumber(identity.organizationId);
  if (!businessNumber) {
    return Response.json(
      { error: "Connect a WhatsApp Business number in Settings before linking a phone." },
      { status: 409 },
    );
  }

  try {
    const issued = await issueLinkCode({
      organizationId: identity.organizationId,
      userId: identity.userId,
      role,
      locale: body && typeof body === "object" && "locale" in body && body.locale === "es-mx" ? "es-mx" : "en",
      businessNumber,
    });

    return Response.json({
      code: issued.code,
      message: issued.message,
      deepLink: issued.deepLink,
      expiresAt: issued.expiresAt.toISOString(),
      role,
    });
  } catch (error) {
    console.error("channel_link_issue_failed", scrubError(error));
    return Response.json({ error: "Could not issue a link code." }, { status: 500 });
  }
}

/** The handsets currently linked to this workspace. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const rows = await getDb()
    .select({
      id: channelIdentities.id,
      channel: channelIdentities.channel,
      externalId: channelIdentities.externalId,
      role: channelIdentities.role,
      locale: channelIdentities.locale,
      verifiedAt: channelIdentities.verifiedAt,
      createdAt: channelIdentities.createdAt,
    })
    .from(channelIdentities)
    .where(eq(channelIdentities.organizationId, identity.organizationId))
    .orderBy(desc(channelIdentities.createdAt));

  return Response.json({
    identities: rows.map((row) => ({
      ...row,
      // Masked even to the workspace's own admins. They know whose handset it
      // is from the role and the link event; a full list of staff mobile
      // numbers in an API response is a liability with no matching use.
      externalId: phoneFingerprint(row.externalId),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

/**
 * Unlink a handset.
 *
 * Deleted rather than marked inactive: `resolveInbound` treats an unverified
 * row as no relationship, but a row that still exists is a row a future code
 * path could misread. Revoking access should remove the thing that grants it.
 */
export async function DELETE(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canInvite(identity.role)) {
    return Response.json({ error: "Only an owner can unlink a phone number." }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "An identity id is required." }, { status: 400 });

  const removed = await getDb()
    .delete(channelIdentities)
    .where(and(eq(channelIdentities.id, id), eq(channelIdentities.organizationId, identity.organizationId)))
    .returning({ id: channelIdentities.id });

  return Response.json({ removed: removed.length });
}

/** This org's connected WhatsApp sending number, or null when none is connected. */
async function connectedBusinessNumber(organizationId: string): Promise<string | null> {
  const config = env as unknown as Record<string, string | undefined>;
  const key = config.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!key) return null;

  const [connection] = await getDb()
    .select({ ciphertext: integrationConnections.accessTokenCiphertext })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, "whatsapp"),
        eq(integrationConnections.status, "connected"),
      ),
    )
    .limit(1);
  if (!connection?.ciphertext) return null;

  try {
    const credentials = JSON.parse(await decryptSecret(connection.ciphertext, key)) as Record<string, string>;
    return credentials.displayPhoneNumber ?? credentials.businessNumber ?? null;
  } catch {
    return null;
  }
}
