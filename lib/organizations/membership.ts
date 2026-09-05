/**
 * Workspace membership: who is in an organization, and how someone joins one.
 *
 * The security-critical function here is `resolveMembership`. A session cookie
 * carries the workspace a user last chose, and that cookie lives for thirty
 * days — long enough for the membership behind it to be revoked. So the claim
 * in the cookie is treated as a *request*, never as authority: every request
 * re-reads membership and falls back to the user's own workspace if the claim
 * no longer holds. Nothing downstream needs to know the difference, which is
 * the point — a route that forgets to check would otherwise be a cross-tenant
 * read.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizationInvitations, organizationMembers, organizations, users } from "@/db/schema";
import { IMPLICIT_OWNER_ROLE, isWorkspaceRole, type WorkspaceRole } from "./roles.ts";

export interface Membership {
  organizationId: string;
  role: WorkspaceRole;
}

/**
 * The workspace and role a user actually holds for this request.
 *
 * `requested` is the workspace the session asked for. It is honoured only if
 * the user owns it or holds a membership row in it; otherwise the personal
 * workspace is returned, so a stale or tampered claim degrades to the user's
 * own data rather than failing the request or reaching someone else's.
 */
export async function resolveMembership(userId: string, personalOrganizationId: string, requested?: string | null): Promise<Membership> {
  const target = requested && requested !== personalOrganizationId ? requested : personalOrganizationId;
  const role = await roleFor(userId, target);
  if (role) return { organizationId: target, role };
  // The personal workspace may not exist as a row yet (ensureOrganization
  // creates it on first use), so its owner role is asserted rather than read.
  return { organizationId: personalOrganizationId, role: IMPLICIT_OWNER_ROLE };
}

/** The user's role in this workspace, or null if they hold none. */
export async function roleFor(userId: string, organizationId: string): Promise<WorkspaceRole | null> {
  const db = getDb();
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (membership && isWorkspaceRole(membership.role)) return membership.role;

  // Ownership recorded on the organization is authoritative even with no
  // membership row: every workspace predates this table, and a missing row
  // must not lock an owner out of their own data.
  const [organization] = await db
    .select({ ownerUserId: organizations.ownerUserId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization?.ownerUserId === userId ? IMPLICIT_OWNER_ROLE : null;
}

export interface MemberRecord {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  joinedAt: Date | null;
  isOwner: boolean;
}

/** Everyone who can act in this workspace, owner first. */
export async function listMembers(organizationId: string): Promise<MemberRecord[]> {
  const db = getDb();
  const [organization] = await db
    .select({ ownerUserId: organizations.ownerUserId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const ownerUserId = organization?.ownerUserId ?? null;

  const rows = await db
    .select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
      email: users.email,
      displayName: users.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId));

  const members: MemberRecord[] = rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: isWorkspaceRole(row.role) ? row.role : "member",
    joinedAt: row.joinedAt,
    isOwner: row.userId === ownerUserId,
  }));

  // An owner with no membership row still belongs in the list, or the
  // workspace would appear to have nobody who can administer it.
  if (ownerUserId && !members.some((member) => member.userId === ownerUserId)) {
    const [owner] = await db.select({ email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, ownerUserId)).limit(1);
    if (owner) {
      members.unshift({ userId: ownerUserId, email: owner.email, displayName: owner.displayName, role: "owner", joinedAt: null, isOwner: true });
    }
  }
  return members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.email.localeCompare(b.email));
}

/** How many people in this workspace may decide an approval. */
export async function approverCount(organizationId: string): Promise<number> {
  const members = await listMembers(organizationId);
  return members.filter((member) => member.role === "owner" || member.role === "approver").length;
}

export async function upsertMembership(input: {
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
  invitedByUserId?: string | null;
}): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(organizationMembers)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      invitedByUserId: input.invitedByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [organizationMembers.organizationId, organizationMembers.userId],
      set: { role: input.role, updatedAt: now },
    });
}

export async function removeMembership(organizationId: string, userId: string): Promise<boolean> {
  const result = await getDb()
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  const value = result as { rowsAffected?: number; meta?: { changes?: number } };
  return (value?.rowsAffected ?? value?.meta?.changes ?? 0) > 0;
}

/** Every workspace this user can act in, so the switcher shows real options. */
export async function listWorkspacesForUser(userId: string, personalOrganizationId: string): Promise<Array<{ organizationId: string; name: string; role: WorkspaceRole; isPersonal: boolean }>> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId, role: organizationMembers.role, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId));

  const workspaces = rows.map((row) => ({
    organizationId: row.organizationId,
    name: row.name,
    role: isWorkspaceRole(row.role) ? row.role : ("member" as WorkspaceRole),
    isPersonal: row.organizationId === personalOrganizationId,
  }));

  if (!workspaces.some((workspace) => workspace.isPersonal)) {
    const [personal] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, personalOrganizationId)).limit(1);
    workspaces.unshift({
      organizationId: personalOrganizationId,
      name: personal?.name ?? "My workspace",
      role: IMPLICIT_OWNER_ROLE,
      isPersonal: true,
    });
  }
  return workspaces.sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.name.localeCompare(b.name));
}

/* ── invitations ─────────────────────────────────────────────────────────── */

/** Long enough to share out of band, short enough that a leaked code expires. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssuedInvitation {
  id: string;
  /** Shown to the inviter exactly once. Only its hash is stored. */
  code: string;
  role: WorkspaceRole;
  expiresAt: Date;
}

export async function issueInvitation(input: {
  organizationId: string;
  role: WorkspaceRole;
  createdByUserId: string;
}): Promise<IssuedInvitation> {
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const id = crypto.randomUUID();
  await getDb().insert(organizationInvitations).values({
    id,
    organizationId: input.organizationId,
    codeHash: await hashCode(code),
    role: input.role,
    createdByUserId: input.createdByUserId,
    expiresAt,
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
  });
  return { id, code, role: input.role, expiresAt };
}

export type AcceptRefusal = "not_found" | "expired" | "already_accepted" | "revoked" | "already_member";

export async function acceptInvitation(code: string, userId: string): Promise<
  | { ok: true; organizationId: string; role: WorkspaceRole }
  | { ok: false; reason: AcceptRefusal }
> {
  const db = getDb();
  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.codeHash, await hashCode(code)))
    .limit(1);
  // A wrong code and an unknown code are the same answer on purpose: telling
  // the difference would turn this into an oracle for guessing valid codes.
  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.revokedAt) return { ok: false, reason: "revoked" };
  if (invitation.acceptedByUserId) return { ok: false, reason: "already_accepted" };
  if (invitation.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const existing = await roleFor(userId, invitation.organizationId);
  if (existing) return { ok: false, reason: "already_member" };

  const role = isWorkspaceRole(invitation.role) ? invitation.role : "member";
  const now = new Date();
  // Claim the invitation before granting access, and only if it is still
  // unclaimed. Two people redeeming one shared code race here; the second
  // update matches no row and gets nothing.
  const claimed = await db
    .update(organizationInvitations)
    .set({ acceptedByUserId: userId, acceptedAt: now })
    .where(and(eq(organizationInvitations.id, invitation.id), isNull(organizationInvitations.acceptedByUserId)));
  const value = claimed as { rowsAffected?: number; meta?: { changes?: number } };
  if ((value?.rowsAffected ?? value?.meta?.changes ?? 0) !== 1) return { ok: false, reason: "already_accepted" };

  await upsertMembership({
    organizationId: invitation.organizationId,
    userId,
    role,
    invitedByUserId: invitation.createdByUserId,
  });
  return { ok: true, organizationId: invitation.organizationId, role };
}

export interface PendingInvitation {
  id: string;
  role: WorkspaceRole;
  createdAt: Date;
  expiresAt: Date;
}

/** Outstanding invitations, so an owner can see and revoke what is live. Codes are never returned. */
export async function listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const rows = await getDb()
    .select({ id: organizationInvitations.id, role: organizationInvitations.role, createdAt: organizationInvitations.createdAt, expiresAt: organizationInvitations.expiresAt })
    .from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.organizationId, organizationId),
      isNull(organizationInvitations.acceptedByUserId),
      isNull(organizationInvitations.revokedAt),
    ))
    .orderBy(desc(organizationInvitations.createdAt));
  return rows
    .filter((row) => row.expiresAt.getTime() > Date.now())
    .map((row) => ({ id: row.id, role: isWorkspaceRole(row.role) ? row.role : "member", createdAt: row.createdAt, expiresAt: row.expiresAt }));
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<boolean> {
  const result = await getDb()
    .update(organizationInvitations)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(organizationInvitations.id, invitationId),
      eq(organizationInvitations.organizationId, organizationId),
      isNull(organizationInvitations.acceptedByUserId),
    ));
  const value = result as { rowsAffected?: number; meta?: { changes?: number } };
  return (value?.rowsAffected ?? value?.meta?.changes ?? 0) > 0;
}

/**
 * Crockford-style base32 over 20 random bytes: no vowels, so it cannot spell
 * anything, and no characters a person confuses when reading a code aloud.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const body = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `AVAL-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
}

/**
 * A code is a bearer credential, so the row holds only its digest. The lookup
 * is by exact hash rather than by scanning, so this is not a password check and
 * needs no work factor — an attacker who reads the table still cannot present a
 * code, and one who guesses is bounded by 32^20.
 */
async function hashCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
