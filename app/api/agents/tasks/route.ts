import { env } from "cloudflare:workers";
import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/security/rate-limit";
import { createTask, listTasks, DEFAULT_MAX_STEPS } from "@/lib/agents/tasks";
import { advanceTask, newWorkerId } from "@/lib/agents/runtime";
import { roleForPersona } from "@/lib/agents/permissions";
import { appendAuditEvents } from "@/lib/audit/log";
import { digestPayload } from "@/lib/audit/chain";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

/**
 * Durable agent tasks — the goal-shaped counterpart to /api/assistant/ask.
 *
 * POST creates a task and runs it as far as one invocation allows. The task is
 * persisted first and advanced second, deliberately: if this request dies
 * halfway, the row survives and the next poll resumes it. A run that returned
 * only when finished would be the "one giant HTTP request" §13 tells us not to
 * build.
 *
 * Guests may create and watch tasks (the demo is the product's front door) but
 * every mutating tool is denied to them by policy, so a guest task can only
 * ever read the shared demo workspace.
 */

const MAX_GOAL_CHARS = 1200;

/** Tighter than the assistant's daily cap because a task fans out to many model calls, and unlike that cap it applies to BYO-credential orgs too — this limits load on Aval's own database, not spend on Aval's model account. */
const CREATE_RULE = { limit: 20, windowMs: 60 * 60 * 1000 };

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);
  const tasks = await listTasks(identity.organizationId);
  return Response.json({
    tasks: tasks.map((task) => ({
      id: task.id,
      agentId: task.agentId,
      goal: task.goal,
      status: task.status,
      steps: { used: task.stepCount, max: task.maxSteps },
      createdAt: task.createdAt,
      finishedAt: task.finishedAt,
      error: task.error,
    })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  // Scoped to the org for a signed-in workspace and to the IP for a guest —
  // every guest shares one org, so an org-scoped limit there would let one
  // visitor exhaust the allowance for all of them.
  const scope = isGuestIdentity(identity) ? `agent_task:ip:${clientIp(request)}` : `agent_task:org:${identity.organizationId}`;
  if (await isRateLimited(scope, CREATE_RULE)) {
    return Response.json({ error: "Too many agent tasks started recently. Try again shortly." }, { status: 429 });
  }
  await recordAttempt(scope);

  const body = (await request.json().catch(() => ({}))) as { goal?: string; agentId?: string; maxSteps?: number };
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, MAX_GOAL_CHARS) : "";
  if (!goal) return Response.json({ error: "A goal is required" }, { status: 400 });

  // An unknown agent id resolves to the read-only `custom` envelope rather
  // than to the broad `general` one, so a typo narrows authority.
  const agentId = typeof body.agentId === "string" && body.agentId ? body.agentId : "general";
  const maxSteps = Number.isInteger(body.maxSteps) ? Math.min(Math.max(body.maxSteps as number, 2), DEFAULT_MAX_STEPS * 2) : undefined;

  const task = await createTask({ organizationId: identity.organizationId, userId: identity.userId, agentId, goal, maxSteps });
  await appendAuditEvents(identity.organizationId, [
    { kind: "task_created", label: roleForPersona(agentId), payloadDigest: await digestPayload(goal), count: task.maxSteps },
  ]);

  const outcome = await advanceTask(env as unknown as AskAvalEnv, identity.organizationId, task.id, newWorkerId());
  return Response.json({ id: task.id, ...outcome }, { status: 202, headers: { "cache-control": "no-store" } });
}
