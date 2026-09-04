/** Pure task-level retry policy for failures that survived provider retries. */

export const MAX_TASK_EXECUTION_ATTEMPTS = 4;

export function taskRetryDelayMs(attempt: number): number {
  // 30s, 1m, 2m, 4m. Jitter is derived from the task id by the caller so two
  // tasks do not synchronize; the deterministic base remains testable here.
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export function retryJitterMs(taskId: string): number {
  let hash = 0;
  for (let index = 0; index < taskId.length; index++) hash = (hash * 31 + taskId.charCodeAt(index)) >>> 0;
  return hash % 10_000;
}

export function shouldRetryTask(retryable: boolean, attemptsAlreadyUsed: number): boolean {
  return retryable && attemptsAlreadyUsed < MAX_TASK_EXECUTION_ATTEMPTS;
}
