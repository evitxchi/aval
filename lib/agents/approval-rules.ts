/**
 * The rules governing whether a decision may be recorded, with no storage
 * dependency so they can be unit-tested directly.
 *
 * Separated from approvals.ts for the same reason lib/agents/task-state.ts is
 * separated from tasks.ts: the guard is the part with the interesting failure
 * modes, and a guard nobody can run tests against is a guard nobody can trust.
 */

import { canApprove, type WorkspaceRole } from "../organizations/roles.ts";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type DecisionRefusal = "already_decided" | "expired" | "self_approval" | "not_an_approver";

/** The approval facts a decision needs. Structural, so nothing here touches a row type. */
export interface DecidableApproval {
  status: ApprovalStatus;
  riskLevel: string;
  expiresAt: Date;
}

/**
 * Whether `decidedByUserId` may record `decision` on this approval right now.
 *
 * Three refusals:
 *
 * - **already decided** — a settled approval is settled. Re-deciding it would
 *   let a rejection be quietly reversed after the fact.
 * - **expired** — checked against the wall clock rather than against whether a
 *   sweep has run, so a request nobody swept is still un-executable. Evidence
 *   goes stale; an amount that was right this morning may not be tonight.
 * - **self-approval** — the person whose task proposed a `critical` action
 *   cannot be the person who approves it. Separation of duties is the reason
 *   a human gate exists at all; letting the requester close it makes the gate
 *   decorative. Scoped to `critical` only, so a high-risk draft send does not
 *   require a second person to be awake.
 * - **not an approver** — a member can run an agent and read everything the
 *   workspace holds without being able to release money. Checked first, so
 *   someone with no authority learns that rather than which action was
 *   proposed.
 */
export function canDecide(
  approval: DecidableApproval,
  decision: "approved" | "rejected",
  decidedByUserId: string,
  requestedByUserId: string,
  deciderRole: WorkspaceRole,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: DecisionRefusal } {
  if (!canApprove(deciderRole)) return { ok: false, reason: "not_an_approver" };
  if (approval.status !== "pending") return { ok: false, reason: "already_decided" };
  if (approval.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  // Rejection is deliberately exempt: anyone who can see the request should be
  // able to stop it. The asymmetry is the point — a gate that is hard to open
  // and easy to close fails in the safe direction.
  if (decision === "approved" && approval.riskLevel === "critical" && decidedByUserId === requestedByUserId) {
    return { ok: false, reason: "self_approval" };
  }
  return { ok: true };
}
