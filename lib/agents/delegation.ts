/**
 * Opening a delegated child task (§19).
 *
 * The rules — who may delegate to whom, how deep, on what budget, with which
 * permissions — live in delegation-rules.ts, free of any storage import so
 * they can be tested directly. This module is the half that writes a row.
 */

import { checkDelegation, type DelegationRefusal } from "./delegation-rules.ts";
import { createTask, type TaskRecord } from "./tasks.ts";

export * from "./delegation-rules.ts";

/** How much of the parent's remaining allowance a child gets. Half, so a parent that delegates still has room to use the answer. */
function childBudget(parent: TaskRecord) {
  return {
    maxSteps: Math.max(2, Math.floor((parent.maxSteps - parent.stepCount) / 2)),
    maxTokens: Math.max(1, Math.floor((parent.maxTokens - parent.tokensUsed) / 2)),
  };
}

export type DelegationResult = { ok: true; task: TaskRecord } | DelegationRefusal;

/**
 * Opens a child task under `parent`.
 *
 * The child carries the parent's `userId`, not the parent agent's identity:
 * authority in this system belongs to a person, and a delegated run must not
 * be able to act on behalf of someone the original request never involved.
 */
export async function delegate(parent: TaskRecord, toPersonaId: string, goal: string): Promise<DelegationResult> {
  const check = checkDelegation(parent, toPersonaId);
  if (!check.ok) return check;

  const budget = childBudget(parent);
  const task = await createTask({
    organizationId: parent.organizationId,
    userId: parent.userId,
    agentId: toPersonaId,
    goal,
    maxSteps: budget.maxSteps,
    maxTokens: budget.maxTokens,
    parentTaskId: parent.id,
    delegationDepth: parent.delegationDepth + 1,
  });
  return { ok: true, task };
}
