/**
 * The task state machine, with no storage dependency.
 *
 * Split from tasks.ts (which imports `@/db`, unresolvable outside the
 * Workers/Vite build) so the transition rules can be unit-tested directly with
 * `node --test` — the same convention lib/ask-aval/persona-validation.ts
 * follows for persona validation. The rules are the part worth testing; the
 * SQL around them is verified separately against a real SQLite instance.
 */

export const TASK_STATES = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** States from which no further execution happens. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * Legal transitions. Written out rather than inferred so an illegal one is a
 * rejected write, not a state nobody noticed the system could reach — the case
 * this exists for is a late worker completing a task a user already cancelled.
 *
 * RUNNING → QUEUED is not a mistake: it is how a run yields at an invocation
 * boundary without ending, leaving the task claimable with its transcript
 * intact.
 */
export const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["WAITING_FOR_TOOL", "WAITING_FOR_APPROVAL", "COMPLETED", "FAILED", "CANCELLED", "QUEUED"],
  WAITING_FOR_TOOL: ["RUNNING", "FAILED", "CANCELLED"],
  WAITING_FOR_APPROVAL: ["RUNNING", "CANCELLED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** How long a worker holds a task before another may claim it. Longer than the slowest single step (a 30s tool plus a 25s model call), short enough that a crashed run resumes promptly. */
export const LEASE_MS = 90_000;

/** Defaults chosen so one task cannot spend a workspace's whole day of model budget: 12 steps is roughly three times the chat loop's four rounds. */
export const DEFAULT_MAX_STEPS = 12;
export const DEFAULT_MAX_TOKENS = 60_000;
