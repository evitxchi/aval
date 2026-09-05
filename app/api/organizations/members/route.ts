/**
 * Workspace membership. Reading the roster is open to anyone in the workspace
 * — knowing who else can see your data is not privileged — while changing it
 * belongs to the owner.
 */

import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { listMembers, removeMembership, roleFor, upsertMembership } from "@/lib/organizations/membership";
import { isWorkspaceRole, removalRefusal } from "@/lib/organizations/roles";
import { appendAuditEvents } from "@/lib/audit/log";
import { digestPayload } from "@/lib/audit/chain";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (isGuestIdentity(identity)) return Response.json({ error: "Sign in to see who is in a workspace." }, { status: 403 });
  await ensureOrganization(identity);
  return Response.json({
    role: identity.role,
    members: await listMembers(identity.organizationId),
  }, { headers: { "cache-control": "no-store" } });
}

/** Changes an existing member's role. Adding someone is done by invitation, never here. */
export async function PATCH(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (isGuestIdentity(identity)) return Response.json({ error: "Sign in to manage a workspace." }, { status: 403 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as { userId?: string; role?: string };
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId || !isWorkspaceRole(body.role)) {
    return Response.json({ error: "userId and role ('owner' | 'approver' | 'member') are required" }, { status: 400 });
  }
  // Only the owner role can grant approval authority, and it cannot be handed
  // out: transferring ownership is a separate, deliberate act.
  if (body.role === "owner") return Response.json({ error: "Ownership cannot be granted from here." }, { status: 400 });

  const targetRole = await roleFor(userId, identity.organizationId);
  if (!targetRole) return Response.json({ error: "That person is not in this workspace." }, { status: 404 });
  const refusal = removalRefusal(identity.role, targetRole, identity.userId, userId);
  if (refusal === "not_permitted") return Response.json({ error: "Only the workspace owner can change roles." }, { status: 403 });
  if (targetRole === "owner") return Response.json({ error: "The owner's role cannot be changed." }, { status: 400 });

  await upsertMembership({ organizationId: identity.organizationId, userId, role: body.role });
  await appendAuditEvents(identity.organizationId, [
    { kind: "membership_changed", label: `role:${body.role}`, payloadDigest: await digestPayload(userId), count: 0 },
  ]);
  return Response.json({ ok: true, members: await listMembers(identity.organizationId) });
}

export async function DELETE(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (isGuestIdentity(identity)) return Response.json({ error: "Sign in to manage a workspace." }, { status: 403 });
  await ensureOrganization(identity);

  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });

  const targetRole = await roleFor(userId, identity.organizationId);
  if (!targetRole) return Response.json({ error: "That person is not in this workspace." }, { status: 404 });

  const refusal = removalRefusal(identity.role, targetRole, identity.userId, userId);
  if (refusal) {
    const message = refusal === "not_permitted" ? "Only the workspace owner can remove people."
      : refusal === "cannot_remove_owner" ? "The workspace owner cannot be removed."
      : "You cannot remove yourself from a workspace you own.";
    return Response.json({ error: message }, { status: 403 });
  }

  const removed = await removeMembership(identity.organizationId, userId);
  if (!removed) return Response.json({ error: "That person is not in this workspace." }, { status: 404 });
  await appendAuditEvents(identity.organizationId, [
    { kind: "membership_changed", label: "removed", payloadDigest: await digestPayload(userId), count: 0 },
  ]);
  // Their session may still name this workspace; resolveMembership re-reads
  // membership per request, so the next call lands them back in their own.
  return Response.json({ ok: true, members: await listMembers(identity.organizationId) });
}
