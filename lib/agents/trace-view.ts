/**
 * Pure presentation logic for the execution trace, split out of
 * app/components/agent-trace.tsx so it can be unit-tested with `node --test` —
 * the component itself imports React and next-intl and cannot be.
 *
 * What lives here is the part with real failure modes: which tone a trace row
 * takes, and how rows group into reasoning steps. Both encode a claim about
 * the runtime, and both are easy to get subtly wrong in a way that misreports
 * what an agent did.
 */

export interface TraceEntryShape {
  sequence: number;
  step: number;
  kind: string;
  policy: string | null;
}

interface TaskStatusShape {
  id: string;
  status: string;
}

const RUNNABLE_STATUS = new Set(["QUEUED", "RUNNING", "WAITING_FOR_TOOL"]);
const APPROVAL_STATUS = "WAITING_FOR_APPROVAL";

/**
 * Picks one task for the next poll to advance. Prefer the open trace, but keep
 * making progress after a reload when no card is expanded.
 */
export function nextTaskToAdvance(tasks: readonly TaskStatusShape[], preferredId: string | null): string | null {
  if (preferredId) {
    const preferred = tasks.find((task) => task.id === preferredId);
    if (preferred && RUNNABLE_STATUS.has(preferred.status)) return preferred.id;
  }
  const runnable = tasks.find((task) => RUNNABLE_STATUS.has(task.status));
  if (runnable) return runnable.id;
  // Poll one parked task when no runnable work remains. This is what observes
  // a decision or expiry and prevents WAITING_FOR_APPROVAL becoming permanent.
  if (preferredId) {
    const preferred = tasks.find((task) => task.id === preferredId);
    if (preferred?.status === APPROVAL_STATUS) return preferred.id;
  }
  return tasks.find((task) => task.status === APPROVAL_STATUS)?.id ?? null;
}

/**
 * Row tones, in the order the classifier checks them.
 *
 * `denied` is deliberately first: a tool call that the policy engine refused
 * is a *denial*, not a tool call, and a classifier that read the kind before
 * the verdict would file it under "read data" and bury the one thing this
 * view exists to surface.
 */
export type RowTone =
  | "denied"
  | "held"
  | "decided"
  | "failed"
  | "retried"
  | "thought"
  | "reserved"
  | "read";

export function toneFor(entry: Pick<TraceEntryShape, "kind" | "policy">): RowTone {
  if (entry.policy === "deny" || entry.kind === "policy_deny") return "denied";
  if (entry.kind === "approval_requested") return "held";
  if (entry.kind === "approval_decided") return "decided";
  if (entry.kind === "error" || entry.kind === "tool_error") return "failed";
  if (entry.kind === "tool_retry") return "retried";
  if (entry.kind === "model_call") return "thought";
  if (entry.kind === "mutation_reserved") return "reserved";
  return "read";
}

/**
 * Groups trace rows into the reasoning steps that produced them.
 *
 * One step is a model call plus every tool call it proposed, so a step maps to
 * several rows (see the `stepIndex` comment in db/schema.ts). Rendering a flat
 * list would lose which investigation each action belonged to, which is most
 * of what makes a trace readable.
 *
 * Steps are ordered by index and rows within a step by sequence, so a trace
 * read back out of order — as it can be, since `listSteps` orders by sequence
 * while steps are appended across several invocations — still renders in the
 * order things actually happened.
 */
export function groupBySteps<T extends TraceEntryShape>(trace: T[]): [number, T[]][] {
  const byStep = new Map<number, T[]>();
  for (const entry of trace) {
    const existing = byStep.get(entry.step);
    if (existing) existing.push(entry);
    else byStep.set(entry.step, [entry]);
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, entries]) => [step, [...entries].sort((a, b) => a.sequence - b.sequence)] as [number, T[]]);
}

/** Whole seconds under a minute, then minutes — a step's duration is operational detail, not a benchmark. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
