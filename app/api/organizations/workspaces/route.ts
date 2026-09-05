/**
 * The workspaces a user can act in, and switching between them.
 *
 * Switching rewrites the session cookie's workspace claim. That claim is not
 * authority — `resolveMembership` re-reads membership on every request — so a
 * request to switch into a workspace the user does not belong to is refused
 * here, and would degrade to their own workspace even if it were not.
 */

import { getApiIdentity, isGuestIdentity, organizationIdForUser } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { listWorkspacesForUser, acceptInvitation, roleFor } from "@/lib/organizations/membership";
import { createSessionCookie } from "@/lib/auth/session-cookie";
import { appendAuditEvents } from "@/lib/audit/log";
import { digestPayload } from "@/lib/audit/chain";
import { isRateLimited, recordAttempt } from "@/lib/security/rate-limit";

/** Codes are guessable only by brute force; this is what keeps that expensive. */
const REDEEM_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (isGuestIdentity(identity)) return Response.json({ error: "Sign in to see your workspaces." }, { status: 403 });
  await ensureOrganization(identity);
  const personal = await organizationIdForUser(identity.userId);
  return Response.json({
    active: identity.organizationId,
    role: identity.role,
    workspaces: await listWorkspacesForUser(identity.userId, personal),
  }, { headers: { "cache-control": "no-store" } });
}

/** Switch workspaces, or redeem an invitation code and switch into that one. */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (identity.source !== "password") {
    // Only a session cookie can carry a workspace choice. Platform-injected
    // identity has nowhere to put one, so switching would silently not stick.
    return Response.json({ error: "Switching workspaces requires a signed-in Aval account." }, { status: 403 });
  }
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as { organizationId?: string; code?: string };
  let target: string;

  if (typeof body.code === "string" && body.code.trim()) {
    const scope = `invite-redeem:${identity.userId}`;
    if (await isRateLimited(scope, REDEEM_LIMIT)) {
      return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
    await recordAttempt(scope);
    const accepted = await acceptInvitation(body.code, identity.userId);
    if (!accepted.ok) {
      const message = accepted.reason === "already_member" ? "You are already in that workspace."
        : accepted.reason === "expired" ? "That invitation has expired. Ask the owner for a new one."
        : accepted.reason === "already_accepted" ? "That invitation has already been used."
        : accepted.reason === "revoked" ? "That invitation was revoked."
        : "That invitation code is not valid.";
      return Response.json({ error: message }, { status: 400 });
    }
    target = accepted.organizationId;
    await appendAuditEvents(target, [
      { kind: "invitation_accepted", label: `role:${accepted.role}`, payloadDigest: await digestPayload(identity.userId), count: 0 },
    ]);
  } else if (typeof body.organizationId === "string" && body.organizationId) {
    target = body.organizationId;
    if (!(await roleFor(identity.userId, target))) {
      // Refused rather than silently ignored: a switcher that appears to work
      // and does not is worse than one that says no.
      return Response.json({ error: "You do not have access to that workspace." }, { status: 403 });
    }
  } else {
    return Response.json({ error: "organizationId or code is required" }, { status: 400 });
  }

  const cookie = await createSessionCookie({
    userId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    activeOrganizationId: target,
  });
  const personal = await organizationIdForUser(identity.userId);
  return new Response(JSON.stringify({
    active: target,
    role: await roleFor(identity.userId, target),
    workspaces: await listWorkspacesForUser(identity.userId, personal),
  }), { status: 200, headers: { "content-type": "application/json", "set-cookie": cookie } });
}
