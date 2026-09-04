import { env } from "cloudflare:workers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { getTask, listSteps, requestCancel, TERMINAL_STATES, type TaskState } from "@/lib/agents/tasks";
import { advanceTask, newWorkerId } from "@/lib/agents/runtime";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

/**
 * One task: its state, its execution trace, and the two things a caller can do
 * to it.
 *
 * GET doubles as the poll that drives the run forward. A task yielded at an
 * invocation boundary (status QUEUED with steps already spent) is advanced
 * here, so progress does not depend on a scheduled worker this stack does not
 * have. Terminal and approval-parked tasks are only read.
 *
 * The step list is the execution trace §24 asks the UI to show: what the agent
 * actually did, in order, with the policy verdict on each tool call. Digests
 * are omitted from the response — they exist to detect tampering in the audit
 * chain, not to be rendered.
 */

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const { id } = await context.params;
  let task = await getTask(identity.organizationId, id);
  if (!task) return Response.json({ error: "No such task" }, { status: 404 });

  const url = new URL(request.url);
  const shouldAdvance = url.searchParams.get("advance") !== "0";
  if (shouldAdvance && (task.status === "QUEUED" || task.status === "WAITING_FOR_TOOL")) {
    await advanceTask(env as unknown as AskAvalEnv, identity.organizationId, id, newWorkerId());
    task = (await getTask(identity.organizationId, id)) ?? task;
  }

  const steps = await listSteps(id, identity.organizationId);
  return Response.json({
    id: task.id,
    agentId: task.agentId,
    goal: task.goal,
    status: task.status,
    steps: { used: task.stepCount, max: task.maxSteps },
    tokens: { used: task.tokensUsed, max: task.maxTokens },
    delegationDepth: task.delegationDepth,
    parentTaskId: task.parentTaskId,
    result: task.resultJson ? safeParse(task.resultJson) : null,
    error: task.error,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    trace: steps.map((step) => ({
      sequence: step.sequence,
      step: step.stepIndex,
      kind: step.kind,
      tool: step.toolName,
      policy: step.policyEffect,
      denyCode: step.denyCode,
      risk: step.riskLevel,
      attempt: step.attempt,
      durationMs: step.durationMs,
      error: step.error,
      at: step.createdAt,
    })),
  }, { headers: { "cache-control": "no-store" } });
}

/** DELETE requests cancellation. A running task stops at its next step boundary; an idle one is cancelled outright. Children are cancelled with it. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const { id } = await context.params;
  const status = await requestCancel(identity.organizationId, id);
  if (!status) return Response.json({ error: "No such task" }, { status: 404 });
  return Response.json({
    id,
    status,
    cancelled: TERMINAL_STATES.has(status as TaskState),
    // A running task is not cancelled yet, only asked to stop — saying so is
    // more honest than reporting a state the system has not reached.
    message: TERMINAL_STATES.has(status as TaskState) ? "Task cancelled." : "Cancellation requested; the task will stop at its next step boundary.",
  }, { headers: { "cache-control": "no-store" } });
}

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return null; }
}
