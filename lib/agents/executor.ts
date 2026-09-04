/**
 * The tool executor: the only path from a model's proposal to a tool actually
 * running.
 *
 * Everything the guide asks for between "the LLM proposed something" and
 * "something happened" lives here, in a fixed order that no caller can
 * reorder or skip:
 *
 *     policy → idempotency → approval → timeout-bounded execution → retry → audit
 *
 * It deliberately produces its audit events rather than writing them, so the
 * caller can append them in one batch when the run resolves. That is the
 * existing discipline in lib/ask-aval/loop.ts — a D1 round-trip inside every
 * tool call would put storage latency on the critical path of every question —
 * and this module inherits it rather than inventing a second convention.
 *
 * The executor never throws for an expected outcome. A denial, a duplicate, a
 * timeout and a tool crash are all *results*, because a caller that has to
 * catch exceptions to learn it was denied will eventually catch one it did not
 * mean to and fail open.
 */

import { runTool } from "@/lib/ask-aval/tools";
import { digestPayload, type AuditEvent } from "@/lib/audit/chain";
import { evaluate, type DenyCode, type PolicyContext, type PolicySubject } from "./policy.ts";
import { idempotencyKey } from "./financial.ts";
import { reserveMutation } from "./tasks.ts";
import type { ToolDescriptor } from "./registry.ts";
import { redactArguments } from "./redaction.ts";

export interface ExecutionRequest {
  toolName: string;
  args: Record<string, unknown>;
  subject: PolicySubject;
  context?: PolicyContext;
  /**
   * Durable-run coordinates. Absent for the synchronous chat loop, which has
   * no task row — the effect is that a mutating tool cannot be executed from
   * the chat loop at all, since there is nowhere to record its idempotency key.
   */
  task?: { id: string; stepIndex: number };
}

export type ExecutionResult =
  | { status: "ok"; json: unknown; numbers: number[]; durationMs: number; attempts: number; tool: ToolDescriptor }
  | { status: "denied"; code: DenyCode; reason: string }
  | { status: "needs_approval"; tool: ToolDescriptor; reason: string; idempotencyKey: string | null }
  | { status: "duplicate"; idempotencyKey: string }
  | { status: "failed"; reason: string; attempts: number; tool: ToolDescriptor };

export interface ExecutionOutcome {
  result: ExecutionResult;
  /** Appended by the caller in one batch when the run resolves. */
  audit: AuditEvent[];
}

/** Backoff between retries. Exponential with a floor, so a transient D1 blip does not become four immediate hammer-blows. */
const RETRY_BASE_MS = 250;

export async function executeTool(request: ExecutionRequest): Promise<ExecutionOutcome> {
  const audit: AuditEvent[] = [];
  const decision = evaluate(request.toolName, request.args, request.subject, request.context ?? {});

  audit.push({
    kind: "policy_decision",
    label: `${request.toolName}:${decision.effect}`,
    payloadDigest: await digestPayload(redactArguments(request.args)),
    count: 0,
  });

  if (decision.effect === "deny") {
    return { result: { status: "denied", code: decision.code, reason: decision.reason }, audit };
  }

  const tool = decision.tool;

  // A mutating tool without a task row has nowhere to record its key, so it
  // cannot be made safe to retry — refusing is the only honest answer.
  const key = tool.mutates
    ? request.task
      ? idempotencyKey(request.task.id, request.task.stepIndex, tool.name)
      : null
    : null;

  if (tool.mutates && !key) {
    return {
      result: { status: "denied", code: "invalid_arguments", reason: `"${tool.name}" changes stored state and can only run inside a durable task.` },
      audit,
    };
  }

  if (decision.effect === "require_approval") {
    audit.push({ kind: "approval_requested", label: tool.name, payloadDigest: await digestPayload(redactArguments(request.args)), count: 0 });
    return { result: { status: "needs_approval", tool, reason: decision.reason, idempotencyKey: key }, audit };
  }

  return reserveThenRun(tool, request, key, audit);
}

/**
 * Claims the idempotency key, then runs.
 *
 * Ordered this way on purpose: the reservation is what makes a duplicate
 * impossible, so it must happen before the side effect, not after it. A
 * read-only tool has no key and skips straight through.
 */
async function reserveThenRun(
  tool: ToolDescriptor,
  request: ExecutionRequest,
  key: string | null,
  audit: AuditEvent[],
): Promise<ExecutionOutcome> {
  if (key && request.task) {
    const reserved = await reserveMutation({
      taskId: request.task.id,
      organizationId: request.subject.organizationId,
      stepIndex: request.task.stepIndex,
      toolName: tool.name,
      idempotencyKey: key,
      argsDigest: await digestPayload(redactArguments(request.args)),
      riskLevel: tool.riskLevel,
    });
    if (!reserved) {
      audit.push({ kind: "tool_call", label: `${tool.name}:duplicate_suppressed`, payloadDigest: await digestPayload(key), count: 0 });
      return { result: { status: "duplicate", idempotencyKey: key }, audit };
    }
  }
  return runWithRetries(tool, request, key, audit);
}

/**
 * Executes an already-authorized tool.
 *
 * Split from `executeTool` so an approved action can resume here without
 * re-running the approval branch and parking itself a second time — the
 * caller supplies the approval it already holds, and the policy re-check is
 * still performed, because an approval from an hour ago is not evidence that
 * the permission still stands now.
 */
export async function executeApprovedTool(request: ExecutionRequest & { task: { id: string; stepIndex: number } }): Promise<ExecutionOutcome> {
  const audit: AuditEvent[] = [];
  const decision = evaluate(request.toolName, request.args, request.subject, request.context ?? {});
  if (decision.effect === "deny") {
    return { result: { status: "denied", code: decision.code, reason: decision.reason }, audit };
  }
  const tool = decision.tool;
  const key = tool.mutates ? idempotencyKey(request.task.id, request.task.stepIndex, tool.name) : null;
  return reserveThenRun(tool, request, key, audit);
}

async function runWithRetries(
  tool: ToolDescriptor,
  request: ExecutionRequest,
  _key: string | null,
  audit: AuditEvent[],
): Promise<ExecutionOutcome> {
  const started = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= tool.maxRetries + 1; attempt++) {
    try {
      const out = await withTimeout(
        runTool(tool.name, request.args, request.subject.organizationId),
        tool.timeoutMs,
        tool.name,
      );
      const durationMs = Date.now() - started;
      audit.push({ kind: "tool_call", label: tool.name, payloadDigest: await digestPayload(out.json), count: out.numbers.length });
      return {
        result: { status: "ok", json: out.json, numbers: out.numbers, durationMs, attempts: attempt, tool },
        audit,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const willRetry = attempt <= tool.maxRetries;
      audit.push({
        kind: willRetry ? "tool_retry" : "tool_error",
        label: tool.name,
        payloadDigest: await digestPayload(lastError),
        count: attempt,
      });
      if (!willRetry) break;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  // A mutating tool that failed keeps its reservation. Freeing it here would
  // re-open the window this design closed: the failure may have been a
  // timeout on an operation that actually succeeded.
  return { result: { status: "failed", reason: lastError, attempts: tool.maxRetries + 1, tool }, audit };
}

/**
 * Bounds a tool's wall-clock time.
 *
 * The losing promise is not cancelled — `runTool` has no abort signal — so
 * this bounds how long the *agent* waits, not how long the query runs. That
 * distinction is why `maxRetries` is zero for every mutating tool in the
 * registry: retrying a timed-out mutation could genuinely double it, and the
 * only safe posture without real cancellation is not to retry.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool "${label}" exceeded its ${ms}ms budget.`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export { redactArguments };
