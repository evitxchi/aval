import { and, eq, asc } from "drizzle-orm";
import { getDb } from "@/db";
import { agentChecks } from "@/db/schema";
import { goalPlan } from "@/lib/agents/goal-plan";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { serializeTraceStep } from "@/lib/agents/trace-view";
import { getTask, listSteps, requestCancel, TERMINAL_STATES, type TaskState } from "@/lib/agents/tasks";

/**
 * One task: its state, its execution trace, and the two things a caller can do
 * to it.
 *
 * GET is strictly read-only. Request-background execution gives a new or
 * approved task a fast start; Cloudflare's cron owns continuation and crash
 * recovery. Observing a task can never spend tokens or execute a tool.
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
  const task = await getTask(identity.organizationId, id);
  if (!task) return Response.json({ error: "No such task" }, { status: 404 });

  const steps = await listSteps(id, identity.organizationId);
  const plan = await goalPlan(identity.organizationId, task.parentTaskId ?? id);
  const checks = await getDb().select().from(agentChecks).where(and(eq(agentChecks.organizationId, identity.organizationId), eq(agentChecks.taskId, id))).orderBy(asc(agentChecks.createdAt));
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
    trace: steps.map(serializeTraceStep),
    completionCondition: safeParse(task.checkJson ?? "{}"),
    deadlineAt: task.deadlineAt,
    plan,
    checks: checks.map(check => ({ step: check.stepIndex, exitCode: check.exitCode, output: safeParse(check.outputJson), at: check.createdAt })),
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
