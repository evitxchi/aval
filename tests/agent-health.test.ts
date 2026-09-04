import assert from "node:assert/strict";
import test from "node:test";
import { assessAgentHealth, type AgentHealthSnapshot } from "../lib/agents/health-rules.ts";

const NOW = new Date("2026-09-04T18:00:00Z");
const healthy = (over: Partial<AgentHealthSnapshot> = {}): AgentHealthSnapshot => ({
  now: NOW,
  lastWorkerCompletedAt: new Date(NOW.getTime() - 60_000),
  oldestQueuedAt: null,
  expiredRunningLeases: 0,
  failedTasks24h: 0,
  pendingApprovals: 0,
  reconciliationDiscrepancies: 0,
  reconciliationOverdue: 0,
  ...over,
});

test("fresh workers, an empty queue, and reconciled money report healthy", () => {
  const result = assessAgentHealth(healthy());
  assert.equal(result.status, "healthy");
  assert.ok(result.checks.every((check) => check.status === "pass"));
});

test("worker and queue SLOs degrade before becoming critical", () => {
  assert.equal(assessAgentHealth(healthy({ lastWorkerCompletedAt: new Date(NOW.getTime() - 4 * 60_000) })).status, "degraded");
  assert.equal(assessAgentHealth(healthy({ oldestQueuedAt: new Date(NOW.getTime() - 11 * 60_000) })).status, "critical");
});

test("expired leases and reconciliation defects are always critical", () => {
  assert.equal(assessAgentHealth(healthy({ expiredRunningLeases: 1 })).status, "critical");
  assert.equal(assessAgentHealth(healthy({ reconciliationDiscrepancies: 1 })).status, "critical");
  assert.equal(assessAgentHealth(healthy({ reconciliationOverdue: 1 })).status, "critical");
});

test("missing worker telemetry fails closed", () => {
  const result = assessAgentHealth(healthy({ lastWorkerCompletedAt: null }));
  assert.equal(result.status, "critical");
  assert.equal(result.checks.find((check) => check.name === "worker_freshness")?.status, "fail");
});
