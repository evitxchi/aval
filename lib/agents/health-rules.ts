export interface AgentHealthSnapshot {
  now: Date;
  lastWorkerCompletedAt: Date | null;
  oldestQueuedAt: Date | null;
  expiredRunningLeases: number;
  failedTasks24h: number;
  pendingApprovals: number;
  reconciliationDiscrepancies: number;
  reconciliationOverdue: number;
}

export type AgentHealthAssessment = {
  status: "healthy" | "degraded" | "critical";
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }>;
};

/** SLO evaluation kept pure so thresholds are executable specification. */
export function assessAgentHealth(snapshot: AgentHealthSnapshot): AgentHealthAssessment {
  const checks: AgentHealthAssessment["checks"] = [];
  const workerAge = snapshot.lastWorkerCompletedAt ? snapshot.now.getTime() - snapshot.lastWorkerCompletedAt.getTime() : Number.POSITIVE_INFINITY;
  checks.push(workerAge <= 3 * 60_000
    ? { name: "worker_freshness", status: "pass", detail: "A background worker completed within three minutes." }
    : workerAge <= 10 * 60_000
      ? { name: "worker_freshness", status: "warn", detail: "No background worker completed within three minutes." }
      : { name: "worker_freshness", status: "fail", detail: "No background worker completed within ten minutes." });

  const queueAge = snapshot.oldestQueuedAt ? snapshot.now.getTime() - snapshot.oldestQueuedAt.getTime() : 0;
  checks.push(queueAge <= 2 * 60_000
    ? { name: "queue_latency", status: "pass", detail: "Oldest runnable task is under two minutes old." }
    : queueAge <= 10 * 60_000
      ? { name: "queue_latency", status: "warn", detail: "Oldest runnable task has waited more than two minutes." }
      : { name: "queue_latency", status: "fail", detail: "Oldest runnable task has waited more than ten minutes." });

  checks.push(snapshot.expiredRunningLeases === 0
    ? { name: "expired_leases", status: "pass", detail: "No task is abandoned behind an expired worker lease." }
    : { name: "expired_leases", status: "fail", detail: `${snapshot.expiredRunningLeases} running task(s) have expired leases.` });

  checks.push(snapshot.reconciliationDiscrepancies === 0 && snapshot.reconciliationOverdue === 0
    ? { name: "financial_reconciliation", status: "pass", detail: "No financial discrepancy or overdue reconciliation is open." }
    : { name: "financial_reconciliation", status: "fail", detail: `${snapshot.reconciliationDiscrepancies} discrepancy(s), ${snapshot.reconciliationOverdue} overdue reconciliation(s).` });

  checks.push(snapshot.failedTasks24h < 3
    ? { name: "task_failures", status: "pass", detail: `${snapshot.failedTasks24h} task failure(s) in the last 24 hours.` }
    : snapshot.failedTasks24h < 10
      ? { name: "task_failures", status: "warn", detail: `${snapshot.failedTasks24h} task failures in the last 24 hours.` }
      : { name: "task_failures", status: "fail", detail: `${snapshot.failedTasks24h} task failures in the last 24 hours.` });

  const status = checks.some((check) => check.status === "fail") ? "critical"
    : checks.some((check) => check.status === "warn") ? "degraded"
      : "healthy";
  return { status, checks };
}
