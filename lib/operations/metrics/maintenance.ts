/**
 * Work-order and vendor performance metrics for the Maintenance tab.
 *
 * Maintenance is consistently the biggest operational stressor operators
 * report, and the vendor-management research is blunt about why: contracts go
 * untracked, SLAs go unmeasured and invoices go unverified, which is
 * expensive in a way nobody can see without these numbers. So the figures here
 * are the ones that change a decision — who is slow, who comes back twice, and
 * who bills over their own estimate.
 *
 * Pure functions over row shapes — see the note at the top of `occupancy.ts`.
 */

import {
  DEFAULT_SLA_TARGET_HOURS,
  OPEN_WORK_ORDER_STATUSES,
  average,
  daysBetween,
  hoursBetween,
  median,
  percentOf,
  round,
  type WorkOrderCategory,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "../types.ts";

export interface WorkOrderLike {
  id: string;
  propertyId: string;
  unitId: string | null;
  vendorId: string | null;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  reportedAt: Date;
  assignedAt: Date | null;
  completedAt: Date | null;
  estimateCents: number | null;
  actualCostCents: number | null;
  callbackOfWorkOrderId: string | null;
}

export interface SlaComplianceRow {
  priority: WorkOrderPriority;
  /**
   * The hours this priority was measured against. Reported alongside the
   * result on purpose: a compliance percentage is meaningless without the bar
   * it was measured against, and these are Aval's defaults rather than the
   * workspace's own contractual SLAs (see `DEFAULT_SLA_TARGET_HOURS`).
   */
  targetHours: number;
  completedCount: number;
  withinTargetCount: number;
  compliancePct: number | null;
  medianHoursToComplete: number | null;
  /** Still open and already past target — the ones that need attention now, not at month end. */
  openBreachedCount: number;
}

/**
 * SLA compliance per priority, measured `reportedAt` → `completedAt`.
 *
 * Only completed work orders enter the compliance percentage, because an open
 * one has no completion time yet. But open work orders already past target are
 * counted separately rather than ignored: a portfolio that never closes its
 * emergencies would otherwise report perfect compliance on the handful it did
 * close, which is precisely backwards.
 */
export function summarizeSlaCompliance(
  workOrders: WorkOrderLike[],
  asOf: Date,
  targets: Record<WorkOrderPriority, number> = DEFAULT_SLA_TARGET_HOURS,
): SlaComplianceRow[] {
  const priorities = Object.keys(targets) as WorkOrderPriority[];

  return priorities.map((priority) => {
    const targetHours = targets[priority];
    const forPriority = workOrders.filter((order) => order.priority === priority);
    const completed = forPriority.filter((order) => order.completedAt !== null);
    const durations = completed.map((order) => hoursBetween(order.reportedAt, order.completedAt as Date));
    const withinTargetCount = durations.filter((hours) => hours <= targetHours).length;
    const medianHours = median(durations);

    const openBreachedCount = forPriority.filter(
      (order) =>
        OPEN_WORK_ORDER_STATUSES.includes(order.status) && hoursBetween(order.reportedAt, asOf) > targetHours,
    ).length;

    return {
      priority,
      targetHours,
      completedCount: completed.length,
      withinTargetCount,
      compliancePct: percentOf(withinTargetCount, completed.length),
      medianHoursToComplete: medianHours === null ? null : round(medianHours, 1),
      openBreachedCount,
    };
  });
}

export interface MaintenanceSummary {
  totalWorkOrders: number;
  openCount: number;
  completedCount: number;
  cancelledCount: number;
  emergencyOpenCount: number;
  /** Median hours from report to assignment — how fast work gets to somebody, as distinct from how fast it gets done. */
  medianHoursToAssign: number | null;
  /** Mean time to repair, in hours, over completed work. */
  meanHoursToComplete: number | null;
  medianHoursToComplete: number | null;
  /** Oldest still-open work order, in days. The number that surfaces a forgotten job. */
  oldestOpenDays: number | null;
  totalActualCostCents: number;
  /** Work orders with no cost recorded — the share of spend this summary cannot see. */
  workOrdersMissingCost: number;
}

export function summarizeMaintenance(workOrders: WorkOrderLike[], asOf: Date): MaintenanceSummary {
  const open = workOrders.filter((order) => OPEN_WORK_ORDER_STATUSES.includes(order.status));
  const completed = workOrders.filter((order) => order.completedAt !== null);

  const assignDurations = workOrders
    .filter((order) => order.assignedAt !== null)
    .map((order) => hoursBetween(order.reportedAt, order.assignedAt as Date));
  const completeDurations = completed.map((order) => hoursBetween(order.reportedAt, order.completedAt as Date));

  const medianAssign = median(assignDurations);
  const meanComplete = average(completeDurations);
  const medianComplete = median(completeDurations);
  const openAges = open.map((order) => daysBetween(order.reportedAt, asOf));

  return {
    totalWorkOrders: workOrders.length,
    openCount: open.length,
    completedCount: completed.length,
    cancelledCount: workOrders.filter((order) => order.status === "cancelled").length,
    emergencyOpenCount: open.filter((order) => order.priority === "emergency").length,
    medianHoursToAssign: medianAssign === null ? null : round(medianAssign, 1),
    meanHoursToComplete: meanComplete === null ? null : round(meanComplete, 1),
    medianHoursToComplete: medianComplete === null ? null : round(medianComplete, 1),
    oldestOpenDays: openAges.length > 0 ? Math.max(...openAges) : null,
    totalActualCostCents: workOrders.reduce((total, order) => total + (order.actualCostCents ?? 0), 0),
    workOrdersMissingCost: workOrders.filter((order) => order.actualCostCents === null).length,
  };
}

export interface CategoryRow {
  category: WorkOrderCategory;
  count: number;
  sharePct: number | null;
  totalCostCents: number;
  medianHoursToComplete: number | null;
}

/**
 * Volume and cost by trade.
 *
 * The breakdown that turns reactive spend into a capital decision: fifteen
 * HVAC calls at one property is a plant nearing end of life, not fifteen
 * unrelated repairs.
 */
export function summarizeByCategory(workOrders: WorkOrderLike[]): CategoryRow[] {
  const groups = new Map<WorkOrderCategory, WorkOrderLike[]>();
  for (const order of workOrders) {
    const group = groups.get(order.category);
    if (group) group.push(order);
    else groups.set(order.category, [order]);
  }

  return [...groups.entries()]
    .map(([category, group]) => {
      const durations = group
        .filter((order) => order.completedAt !== null)
        .map((order) => hoursBetween(order.reportedAt, order.completedAt as Date));
      const medianHours = median(durations);
      return {
        category,
        count: group.length,
        sharePct: percentOf(group.length, workOrders.length),
        totalCostCents: group.reduce((total, order) => total + (order.actualCostCents ?? 0), 0),
        medianHoursToComplete: medianHours === null ? null : round(medianHours, 1),
      };
    })
    .sort((a, b) => b.count - a.count);
}

export interface VendorScorecardRow {
  vendorId: string;
  assignedCount: number;
  completedCount: number;
  medianHoursToComplete: number | null;
  /** Completed within the SLA target for each work order's own priority. */
  slaCompliancePct: number | null;
  /**
   * Share of this vendor's completed work that no return visit was logged
   * against. Counted only from explicit `callbackOfWorkOrderId` links, never
   * inferred from a second job in the same unit — see
   * `CALLBACK_SUGGESTION_WINDOW_DAYS`.
   */
  firstTimeFixPct: number | null;
  callbackCount: number;
  totalCostCents: number;
  /**
   * Actual cost against estimate, as a percent, over jobs carrying both.
   * Positive means the vendor bills over its own quote. Null when no job has
   * both figures — this is the metric most often unmeasurable, and saying so
   * is more useful than reporting 0% overrun on missing data.
   */
  costVsEstimatePct: number | null;
  jobsWithBothCostFigures: number;
}

/**
 * Per-vendor performance.
 *
 * Everything an operator needs for a renewal conversation, and nothing
 * inferred: a vendor with no callbacks logged shows `firstTimeFixPct: 100`
 * only because the work orders say so, and one with no estimates on file shows
 * `costVsEstimatePct: null` rather than an implied "on budget".
 */
export function buildVendorScorecards(
  workOrders: WorkOrderLike[],
  targets: Record<WorkOrderPriority, number> = DEFAULT_SLA_TARGET_HOURS,
): VendorScorecardRow[] {
  const callbackTargets = new Set(
    workOrders.map((order) => order.callbackOfWorkOrderId).filter((id): id is string => id !== null),
  );

  const groups = new Map<string, WorkOrderLike[]>();
  for (const order of workOrders) {
    if (order.vendorId === null) continue;
    const group = groups.get(order.vendorId);
    if (group) group.push(order);
    else groups.set(order.vendorId, [order]);
  }

  return [...groups.entries()]
    .map(([vendorId, group]) => {
      const completed = group.filter((order) => order.completedAt !== null);
      const durations = completed.map((order) => hoursBetween(order.reportedAt, order.completedAt as Date));
      const withinTarget = completed.filter(
        (order) => hoursBetween(order.reportedAt, order.completedAt as Date) <= targets[order.priority],
      ).length;

      const calledBack = completed.filter((order) => callbackTargets.has(order.id)).length;
      const withBoth = group.filter((order) => order.estimateCents !== null && order.actualCostCents !== null);
      const estimateTotal = withBoth.reduce((total, order) => total + (order.estimateCents as number), 0);
      const actualTotal = withBoth.reduce((total, order) => total + (order.actualCostCents as number), 0);
      const medianHours = median(durations);

      return {
        vendorId,
        assignedCount: group.length,
        completedCount: completed.length,
        medianHoursToComplete: medianHours === null ? null : round(medianHours, 1),
        slaCompliancePct: percentOf(withinTarget, completed.length),
        firstTimeFixPct: percentOf(completed.length - calledBack, completed.length),
        callbackCount: calledBack,
        totalCostCents: group.reduce((total, order) => total + (order.actualCostCents ?? 0), 0),
        costVsEstimatePct:
          estimateTotal > 0 ? round(((actualTotal - estimateTotal) / estimateTotal) * 100, 2) : null,
        jobsWithBothCostFigures: withBoth.length,
      };
    })
    .sort((a, b) => b.assignedCount - a.assignedCount);
}

/**
 * Portfolio-wide first-time-fix rate.
 *
 * The single metric the vendor research ties most directly to cost: tracking
 * it per vendor and feeding it into renewals is associated with a sharp drop
 * in repeat calls. Null with no completed work, because a rate over zero jobs
 * is not 100%.
 */
export function firstTimeFixPct(workOrders: WorkOrderLike[]): number | null {
  const completed = workOrders.filter((order) => order.completedAt !== null);
  const callbackTargets = new Set(
    workOrders.map((order) => order.callbackOfWorkOrderId).filter((id): id is string => id !== null),
  );
  const calledBack = completed.filter((order) => callbackTargets.has(order.id)).length;
  return percentOf(completed.length - calledBack, completed.length);
}

/**
 * Maintenance spend per unit over a period — the figure that makes properties
 * of different sizes comparable, and the one an owner benchmarks.
 *
 * Null when the unit count is zero rather than dividing by it.
 */
export function costPerUnitCents(workOrders: WorkOrderLike[], unitCount: number): number | null {
  if (unitCount <= 0) return null;
  const total = workOrders.reduce((sum, order) => sum + (order.actualCostCents ?? 0), 0);
  return Math.round(total / unitCount);
}

export interface CallbackSuggestion {
  candidateWorkOrderId: string;
  possibleOriginalWorkOrderId: string;
  unitId: string;
  category: WorkOrderCategory;
  daysAfterCompletion: number;
}

/**
 * Work orders that *might* be unlogged callbacks: same unit, same category,
 * opened within `windowDays` of a completion.
 *
 * Returned as suggestions for a human to confirm, and never fed into
 * `firstTimeFixPct` or a vendor scorecard. Two genuinely different faults in
 * one busy unit look exactly like this from the outside, and a vendor's
 * renewal is not a place to put an inference.
 */
export function suggestCallbacks(
  workOrders: WorkOrderLike[],
  windowDays: number,
): CallbackSuggestion[] {
  const completed = workOrders.filter((order) => order.completedAt !== null && order.unitId !== null);
  const suggestions: CallbackSuggestion[] = [];

  for (const candidate of workOrders) {
    if (candidate.unitId === null || candidate.callbackOfWorkOrderId !== null) continue;
    for (const original of completed) {
      if (original.id === candidate.id) continue;
      if (original.unitId !== candidate.unitId || original.category !== candidate.category) continue;
      const gap = daysBetween(original.completedAt as Date, candidate.reportedAt);
      if (gap < 0 || gap > windowDays) continue;
      suggestions.push({
        candidateWorkOrderId: candidate.id,
        possibleOriginalWorkOrderId: original.id,
        unitId: candidate.unitId,
        category: candidate.category,
        daysAfterCompletion: gap,
      });
    }
  }

  return suggestions.sort((a, b) => a.daysAfterCompletion - b.daysAfterCompletion);
}
