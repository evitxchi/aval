/**
 * What each role may do over a messaging channel.
 *
 * The build brief names four roles — owner, manager, coordinator, tenant. This
 * codebase already has three workspace roles (`lib/organizations/roles.ts`),
 * and they are load-bearing: `canApprove`, `canInvite`, `canManagePolicy` and
 * `canManageMembers` all read them, and they decide who can release money. So
 * the brief's roles are *mapped onto* ours rather than replacing them:
 *
 *   owner       → owner
 *   manager     → approver
 *   coordinator → member
 *   tenant      → resident   (not a WorkspaceRole at all)
 *
 * `resident` is the one that is genuinely new, and it deliberately stays
 * outside `WorkspaceRole`. A resident is not a member of the workspace — they
 * have no `users` row and no membership — and widening `WorkspaceRole` to
 * admit one would hand every existing membership check a value it was never
 * written to reason about. The safest version of "can a resident approve a
 * payment?" is one where the question cannot be typed.
 */

import { WORKSPACE_ROLES, isWorkspaceRole, type WorkspaceRole } from "../organizations/roles.ts";

/** A workspace member's role, or a resident who is reachable but not a member. */
export type ChannelRole = WorkspaceRole | "resident";

export const CHANNEL_ROLES: readonly ChannelRole[] = [...WORKSPACE_ROLES, "resident"] as const;

export function isChannelRole(value: unknown): value is ChannelRole {
  return typeof value === "string" && (CHANNEL_ROLES as readonly string[]).includes(value);
}

/** True for a role that belongs to an actual workspace member. */
export function isMemberRole(role: ChannelRole): role is WorkspaceRole {
  return isWorkspaceRole(role);
}

/**
 * The Ask Aval tools each role may reach, named as the brief requires: the role
 * selects the tool set **before the loop starts**, so a role that cannot see
 * accounting is not relying on the model to decline.
 *
 * `null` means "every read tool this persona already offers" — the widest set,
 * and still read-only, because Ask Aval's registry (`lib/ask-aval/tools.ts`)
 * contains no mutation. Writes live in the agent runtime and are gated
 * separately (`lib/channels/hooks.ts`).
 *
 * A resident's set is the interesting one. It is not "fewer portfolio tools",
 * it is a different shape entirely: nothing that aggregates across the
 * portfolio, because a resident asking "how much is outstanding" must not
 * receive the building's number. Until a resident-scoped read tool exists,
 * the honest set is empty and the channel answers residents from templates
 * only — see `residentToolNames`.
 */
export function toolNamesForRole(role: ChannelRole): string[] | null {
  switch (role) {
    case "owner":
    case "approver":
      return null;
    case "member":
      // A coordinator runs the day, and does not need the ledger to do it.
      return [
        "get_portfolio_metrics",
        "get_leasing_funnel",
        "get_metric_series",
        "list_documents",
        "read_document",
        "render_answer",
      ];
    case "resident":
      return residentToolNames();
  }
}

/**
 * Deliberately empty, and deliberately a function rather than a constant so
 * the comment above it survives.
 *
 * Every read tool in `lib/ask-aval/tools.ts` is portfolio-scoped: it answers
 * about an organization, not about one resident. Handing any of them to a
 * resident would answer "what do I owe?" with what the *building* owes. There
 * is no correct subset of the current registry, so the correct set is none —
 * a resident's messages are answered from templates and handed to a human,
 * never by a model holding portfolio tools.
 *
 * The fix is a resident-scoped tool (`get_my_balance`, keyed on
 * `channel_identities.contactId`), not a filter over these.
 */
export function residentToolNames(): string[] {
  return ["render_answer"];
}

/** Whether this role may propose anything that writes. Residents never can. */
export function canPropose(role: ChannelRole): boolean {
  return isMemberRole(role);
}

/**
 * Whether this role may confirm a write it proposed.
 *
 * Mirrors `canApprove` for workspace roles rather than re-deciding it: the
 * channel must not become a second, laxer route to the same authority. A
 * coordinator can ask for a thing to happen and cannot be the one who says yes.
 */
export function canConfirm(role: ChannelRole): boolean {
  return role === "owner" || role === "approver";
}
