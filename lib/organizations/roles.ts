/**
 * What each workspace role may do.
 *
 * Pure and storage-free so the rules can be tested directly — these decide who
 * can release money, and a rule nobody can run tests against is a rule nobody
 * can trust.
 *
 * The set is deliberately small. A role that no caller checks is not a
 * permission, it is a label, and labels in an authorization model are how a
 * system comes to look more governed than it is.
 */

export const WORKSPACE_ROLES = ["owner", "approver", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/**
 * Whether this role may decide an agent approval.
 *
 * A member can run an agent and read everything the workspace holds, and still
 * not release a payment. That separation is the reason to have roles at all:
 * inviting a colleague to look at the portfolio should not hand them the
 * ability to approve a transfer.
 */
export function canApprove(role: WorkspaceRole): boolean {
  return role === "owner" || role === "approver";
}

/** Invitations grant standing access to tenant data, so only the owner issues them. */
export function canInvite(role: WorkspaceRole): boolean {
  return role === "owner";
}

/** Financial limits, allowlists and approval tiers are the owner's to set. */
export function canManagePolicy(role: WorkspaceRole): boolean {
  return role === "owner";
}

/**
 * Removing a member revokes their access to everything the workspace holds, so
 * it sits with the owner. An owner cannot be removed at all — see
 * `removalRefusal`.
 */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "owner";
}

export type RemovalRefusal = "not_permitted" | "cannot_remove_owner" | "cannot_remove_self";

/**
 * Why a removal is refused, or null when it may proceed.
 *
 * Two refusals beyond permission, both about not stranding a workspace: the
 * owner is the only role that can invite or set policy, so removing one would
 * leave a workspace nobody can administer, and an owner removing themselves is
 * the same mistake by another route.
 */
export function removalRefusal(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  actorUserId: string,
  targetUserId: string,
): RemovalRefusal | null {
  if (!canManageMembers(actorRole)) return "not_permitted";
  if (targetRole === "owner") return "cannot_remove_owner";
  if (actorUserId === targetUserId) return "cannot_remove_self";
  return null;
}

/**
 * The role a workspace's own owner holds without a membership row.
 *
 * Every organization predates this table and records its owner on the
 * organization itself. Treating that as authoritative means no backfill is
 * needed and no existing user can be locked out of their own workspace by a
 * missing row.
 */
export const IMPLICIT_OWNER_ROLE: WorkspaceRole = "owner";
