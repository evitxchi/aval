import assert from "node:assert/strict";
import test from "node:test";
import { MAX_TASK_EXECUTION_ATTEMPTS, retryJitterMs, shouldRetryTask, taskRetryDelayMs } from "../lib/agents/retry-policy.ts";

test("task retries are bounded and only apply to retryable failures", () => {
  assert.equal(shouldRetryTask(false, 0), false);
  assert.equal(shouldRetryTask(true, 0), true);
  assert.equal(shouldRetryTask(true, MAX_TASK_EXECUTION_ATTEMPTS), false);
});

test("retry delay doubles and remains capped", () => {
  assert.equal(taskRetryDelayMs(1), 30_000);
  assert.equal(taskRetryDelayMs(2), 60_000);
  assert.equal(taskRetryDelayMs(3), 120_000);
  assert.ok(taskRetryDelayMs(100) <= 10 * 60_000);
});

test("jitter is stable per task and bounded below ten seconds", () => {
  const first = retryJitterMs("task_abc");
  assert.equal(retryJitterMs("task_abc"), first);
  assert.ok(first >= 0 && first < 10_000);
  assert.notEqual(retryJitterMs("task_abc"), retryJitterMs("task_xyz"));
});
