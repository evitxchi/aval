import { and, asc, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { agentApprovals, agentFinancialOperations, agentTasks, agentWorkerRuns } from "@/db/schema";
import { assessAgentHealth, type AgentHealthSnapshot } from "./health-rules.ts";

export async function getAgentHealth(organizationId: string, now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [worker, oldestQueued, expired, failures, approvals, discrepancies, overdue] = await Promise.all([
    getDb().select({ finishedAt: agentWorkerRuns.finishedAt }).from(agentWorkerRuns)
      .where(eq(agentWorkerRuns.status, "completed")).orderBy(desc(agentWorkerRuns.finishedAt)).limit(1),
    getDb().select({ createdAt: agentTasks.createdAt }).from(agentTasks)
      .where(and(eq(agentTasks.organizationId, organizationId), inArray(agentTasks.status, ["QUEUED", "WAITING_FOR_TOOL"])))
      .orderBy(asc(agentTasks.createdAt)).limit(1),
    count(agentTasks, and(eq(agentTasks.organizationId, organizationId), eq(agentTasks.status, "RUNNING"), lt(agentTasks.leaseExpiresAt, now))),
    count(agentTasks, and(eq(agentTasks.organizationId, organizationId), eq(agentTasks.status, "FAILED"), gte(agentTasks.finishedAt, dayAgo))),
    count(agentApprovals, and(eq(agentApprovals.organizationId, organizationId), eq(agentApprovals.status, "pending"))),
    count(agentFinancialOperations, and(eq(agentFinancialOperations.organizationId, organizationId), inArray(agentFinancialOperations.reconciliationStatus, ["mismatch", "manual_review"]))),
    count(agentFinancialOperations, and(eq(agentFinancialOperations.organizationId, organizationId), ne(agentFinancialOperations.reconciliationStatus, "matched"), lt(agentFinancialOperations.nextReconcileAt, new Date(now.getTime() - 10 * 60_000)))),
  ]);
  const snapshot: AgentHealthSnapshot = {
    now,
    lastWorkerCompletedAt: worker[0]?.finishedAt ?? null,
    oldestQueuedAt: oldestQueued[0]?.createdAt ?? null,
    expiredRunningLeases: expired,
    failedTasks24h: failures,
    pendingApprovals: approvals,
    reconciliationDiscrepancies: discrepancies,
    reconciliationOverdue: overdue,
  };
  return { snapshot, assessment: assessAgentHealth(snapshot) };
}

/** Aggregate, payload-free health for a bearer-authenticated uptime monitor. */
export async function getGlobalAgentHealth(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [worker, oldestQueued, expired, failures, approvals, discrepancies, overdue] = await Promise.all([
    getDb().select({ finishedAt: agentWorkerRuns.finishedAt }).from(agentWorkerRuns)
      .where(eq(agentWorkerRuns.status, "completed")).orderBy(desc(agentWorkerRuns.finishedAt)).limit(1),
    getDb().select({ createdAt: agentTasks.createdAt }).from(agentTasks)
      .where(inArray(agentTasks.status, ["QUEUED", "WAITING_FOR_TOOL"]))
      .orderBy(asc(agentTasks.createdAt)).limit(1),
    count(agentTasks, and(eq(agentTasks.status, "RUNNING"), lt(agentTasks.leaseExpiresAt, now))),
    count(agentTasks, and(eq(agentTasks.status, "FAILED"), gte(agentTasks.finishedAt, dayAgo))),
    count(agentApprovals, eq(agentApprovals.status, "pending")),
    count(agentFinancialOperations, inArray(agentFinancialOperations.reconciliationStatus, ["mismatch", "manual_review"])),
    count(agentFinancialOperations, and(ne(agentFinancialOperations.reconciliationStatus, "matched"), lt(agentFinancialOperations.nextReconcileAt, new Date(now.getTime() - 10 * 60_000)))),
  ]);
  const snapshot: AgentHealthSnapshot = {
    now,
    lastWorkerCompletedAt: worker[0]?.finishedAt ?? null,
    oldestQueuedAt: oldestQueued[0]?.createdAt ?? null,
    expiredRunningLeases: expired,
    failedTasks24h: failures,
    pendingApprovals: approvals,
    reconciliationDiscrepancies: discrepancies,
    reconciliationOverdue: overdue,
  };
  return { snapshot, assessment: assessAgentHealth(snapshot) };
}

async function count(table: SQLiteTable, condition: SQL | undefined): Promise<number> {
  const [row] = await getDb().select({ value: sql<number>`count(*)` }).from(table).where(condition);
  return Number(row?.value ?? 0);
}
