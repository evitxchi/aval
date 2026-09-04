/**
 * Human approval (§12). The agent prepares the action; a person decides
 * whether it executes.
 *
 * The shape that matters is the one the guide draws: an approval is not a
 * confirmation dialog bolted onto an action that was going to happen anyway.
 * It is a durable row the task is *parked on* — the run enters
 * WAITING_FOR_APPROVAL, the worker releases its lease and stops, and nothing
 * resumes until a decision is recorded. A rejected approval is retained
 * exactly like an approved one, because "we asked and were told no" is the
 * record that matters most when something later goes wrong.
 *
 * Approvals expire. An amount that was right this morning may not be tonight,
 * and a request left open for a week should not be executable on the strength
 * of a decision made against stale evidence.
 */

import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { agentApprovals } from "@/db/schema";
import { approvalTierFor, type ApprovalTier } from "./financial.ts";
import type { ToolDescriptor } from "./registry.ts";

import { canDecide } from "./approval-rules.ts";
import { APPROVAL_TTL_MS } from "./approvals-ttl.ts";
export type { ApprovalStatus } from "./approval-rules.ts";
import type { ApprovalStatus } from "./approval-rules.ts";

export { APPROVAL_TTL_MS } from "./approvals-ttl.ts";

export interface ApprovalRequest {
  taskId: string;
  organizationId: string;
  stepIndex: number;
  tool: ToolDescriptor;
  /** Redacted argument summary plus whatever the agent assembled to justify the action. Shown to the approver verbatim. */
  evidence: Record<string, unknown>;
  amountCents?: number;
  currency?: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  organizationId: string;
  stepIndex: number;
  toolName: string;
  riskLevel: string;
  tier: ApprovalTier;
  amountCents: number | null;
  currency: string | null;
  evidenceJson: string;
  status: ApprovalStatus;
  requestedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
}

/**
 * Parks an action for approval.
 *
 * The unique index on `(taskId, stepIndex)` means a resumed worker that
 * re-reaches the same step cannot open a second request for it — the insert
 * fails and the existing row is returned instead, so a crash between
 * "requested" and "task parked" is recoverable without creating a duplicate a
 * person would have to reconcile.
 */
export async function requestApproval(request: ApprovalRequest): Promise<ApprovalRecord> {
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    taskId: request.taskId,
    organizationId: request.organizationId,
    stepIndex: request.stepIndex,
    toolName: request.tool.name,
    riskLevel: request.tool.riskLevel,
    tier: request.amountCents === undefined ? ("single_approver" as ApprovalTier) : approvalTierFor(request.amountCents),
    amountCents: request.amountCents ?? null,
    currency: request.currency ?? null,
    evidenceJson: JSON.stringify(request.evidence),
    status: "pending" as ApprovalStatus,
    requestedAt: now,
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
  };

  try {
    await getDb().insert(agentApprovals).values(row);
    return row;
  } catch {
    const existing = await findByStep(request.organizationId, request.taskId, request.stepIndex);
    if (existing) return existing;
    throw new Error("Could not open an approval request for this step.");
  }
}

async function findByStep(organizationId: string, taskId: string, stepIndex: number): Promise<ApprovalRecord | null> {
  const [row] = await getDb()
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.organizationId, organizationId), eq(agentApprovals.taskId, taskId), eq(agentApprovals.stepIndex, stepIndex)))
    .limit(1);
  return (row as ApprovalRecord | undefined) ?? null;
}

export async function getApproval(organizationId: string, approvalId: string): Promise<ApprovalRecord | null> {
  const [row] = await getDb()
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.id, approvalId), eq(agentApprovals.organizationId, organizationId)))
    .limit(1);
  return (row as ApprovalRecord | undefined) ?? null;
}

/**
 * The most recent approval opened for a task, whatever its status.
 *
 * The resume path needs the *decided* one, not a pending one: it carries the
 * step index the proposal was made at, which is what makes the retried
 * idempotency key match the original. Reading it back beats storing the
 * pending call anywhere else, because the transcript already holds the real
 * arguments and this row already holds the decision.
 */
export async function latestApprovalForTask(organizationId: string, taskId: string): Promise<ApprovalRecord | null> {
  const [row] = await getDb()
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.organizationId, organizationId), eq(agentApprovals.taskId, taskId)))
    .orderBy(desc(agentApprovals.stepIndex))
    .limit(1);
  return (row as ApprovalRecord | undefined) ?? null;
}

export async function listPendingApprovals(organizationId: string, limit = 50): Promise<ApprovalRecord[]> {
  const rows = await getDb()
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.organizationId, organizationId), eq(agentApprovals.status, "pending")))
    .orderBy(desc(agentApprovals.requestedAt))
    .limit(limit);
  return rows as ApprovalRecord[];
}

export type DecisionOutcome =
  | { ok: true; approval: ApprovalRecord }
  | { ok: false; reason: "not_found" | "already_decided" | "expired" | "self_approval" };

/**
 * Records a decision.
 *
 * Three refusals, all deterministic:
 *
 * - **already decided** — the `status = pending` clause in the update makes a
 *   double decision a zero-row write rather than an overwrite, so two people
 *   clicking at once cannot produce a "rejected" row that later reads as
 *   approved.
 * - **expired** — checked against the wall clock, not against whether a sweep
 *   has run, so a request nobody swept is still un-executable.
 * - **self-approval** — the user who caused the task to be created cannot
 *   approve its own critical action. Separation of duties is the reason a
 *   human gate exists at all; letting the requester close it makes the gate
 *   decorative. Applies to `critical` only, so a high-risk draft send does not
 *   need a second person present.
 */
export async function decideApproval(
  organizationId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  decidedByUserId: string,
  requestedByUserId: string,
  note?: string,
): Promise<DecisionOutcome> {
  const approval = await getApproval(organizationId, approvalId);
  if (!approval) return { ok: false, reason: "not_found" };

  const guard = canDecide(approval, decision, decidedByUserId, requestedByUserId);
  if (!guard.ok) {
    // Expiry is also written through, so the row stops appearing as pending —
    // but the refusal above does not depend on that write succeeding.
    if (guard.reason === "expired") {
      await getDb().update(agentApprovals).set({ status: "expired" }).where(eq(agentApprovals.id, approvalId)).catch(() => {});
    }
    return { ok: false, reason: guard.reason };
  }

  const now = new Date();
  await getDb()
    .update(agentApprovals)
    .set({ status: decision, decidedAt: now, decidedByUserId, decisionNote: note ?? null })
    .where(and(eq(agentApprovals.id, approvalId), eq(agentApprovals.status, "pending")));

  const updated = await getApproval(organizationId, approvalId);
  if (!updated || updated.status !== decision) return { ok: false, reason: "already_decided" };
  return { ok: true, approval: updated };
}

/** Marks overdue requests expired. Called opportunistically from the approvals listing, the same idiom lib/security/rate-limit.ts uses — this app has no scheduled worker to sweep on a timer. */
export async function expireStaleApprovals(organizationId: string): Promise<void> {
  await getDb()
    .update(agentApprovals)
    .set({ status: "expired" })
    .where(and(eq(agentApprovals.organizationId, organizationId), eq(agentApprovals.status, "pending"), lt(agentApprovals.expiresAt, new Date())))
    .catch((err) => console.error("agent_approval_expiry_failed", err));
}
