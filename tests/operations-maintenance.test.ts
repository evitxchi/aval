import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVendorScorecards,
  costPerUnitCents,
  firstTimeFixPct,
  suggestCallbacks,
  summarizeByCategory,
  summarizeMaintenance,
  summarizeSlaCompliance,
  type WorkOrderLike,
} from "../lib/operations/metrics/maintenance.ts";
import { MS_PER_DAY, MS_PER_HOUR, type WorkOrderPriority } from "../lib/operations/types.ts";

const ASOF = new Date("2026-09-03T00:00:00Z");
const hoursAgo = (hours: number) => new Date(ASOF.getTime() - hours * MS_PER_HOUR);
const daysAgo = (days: number) => new Date(ASOF.getTime() - days * MS_PER_DAY);

let sequence = 0;
function order(overrides: Partial<WorkOrderLike> = {}): WorkOrderLike {
  sequence += 1;
  return {
    id: `wo-${sequence}`,
    propertyId: "p1",
    unitId: "u1",
    vendorId: "v1",
    category: "plumbing",
    priority: "routine",
    status: "completed",
    reportedAt: hoursAgo(48),
    assignedAt: hoursAgo(47),
    completedAt: hoursAgo(24),
    estimateCents: null,
    actualCostCents: null,
    callbackOfWorkOrderId: null,
    ...overrides,
  };
}

test("SLA compliance reports the target it was measured against, not just a percentage", () => {
  const rows = summarizeSlaCompliance(
    [
      order({ priority: "emergency", reportedAt: hoursAgo(10), completedAt: hoursAgo(8) }), // 2h — within 4h
      order({ priority: "emergency", reportedAt: hoursAgo(20), completedAt: hoursAgo(5) }), // 15h — breach
    ],
    ASOF,
  );
  const emergency = rows.find((row) => row.priority === "emergency");
  assert.equal(emergency?.targetHours, 4);
  assert.equal(emergency?.completedCount, 2);
  assert.equal(emergency?.withinTargetCount, 1);
  assert.equal(emergency?.compliancePct, 50);
});

test("open work orders already past target are counted separately, not ignored", () => {
  const rows = summarizeSlaCompliance(
    [
      // Never closed and 10 hours old against a 4-hour target.
      order({ priority: "emergency", status: "in_progress", reportedAt: hoursAgo(10), completedAt: null }),
      order({ priority: "emergency", reportedAt: hoursAgo(3), completedAt: hoursAgo(1) }),
    ],
    ASOF,
  );
  const emergency = rows.find((row) => row.priority === "emergency");
  // The one it did close was on time, so compliance reads 100% — which is
  // precisely why the open breach has to be visible next to it.
  assert.equal(emergency?.compliancePct, 100);
  assert.equal(emergency?.openBreachedCount, 1);
});

test("compliance is null, not 100%, for a priority with nothing completed", () => {
  const rows = summarizeSlaCompliance([order({ priority: "urgent", status: "reported", completedAt: null })], ASOF);
  assert.equal(rows.find((row) => row.priority === "urgent")?.compliancePct, null);
});

test("first-time-fix counts only explicitly linked callbacks", () => {
  const original = order({ id: "wo-original" });
  const callback = order({ id: "wo-callback", callbackOfWorkOrderId: "wo-original" });
  const unrelated = order({ id: "wo-unrelated" });

  assert.equal(firstTimeFixPct([original, callback, unrelated]), 66.67);
  // Same three jobs with the link removed: nothing is inferred from them being
  // in the same unit and trade.
  assert.equal(firstTimeFixPct([original, order({ id: "wo-callback" }), unrelated]), 100);
});

test("first-time-fix is null with no completed work — a rate over zero jobs is not 100%", () => {
  assert.equal(firstTimeFixPct([order({ status: "reported", completedAt: null })]), null);
  assert.equal(firstTimeFixPct([]), null);
});

test("vendor scorecards report cost against estimate only where both figures exist", () => {
  const [scorecard] = buildVendorScorecards([
    order({ vendorId: "v1", estimateCents: 100_000, actualCostCents: 130_000 }),
    order({ vendorId: "v1", estimateCents: 100_000, actualCostCents: 110_000 }),
    // No estimate: excluded from the variance, still counted in total cost.
    order({ vendorId: "v1", estimateCents: null, actualCostCents: 50_000 }),
  ]);
  assert.equal(scorecard.jobsWithBothCostFigures, 2);
  assert.equal(scorecard.costVsEstimatePct, 20); // 240,000 against 200,000
  assert.equal(scorecard.totalCostCents, 290_000);
});

test("cost-vs-estimate is null rather than an implied on-budget when no job carries both", () => {
  const [scorecard] = buildVendorScorecards([order({ vendorId: "v1", estimateCents: null, actualCostCents: 50_000 })]);
  assert.equal(scorecard.costVsEstimatePct, null);
  assert.equal(scorecard.jobsWithBothCostFigures, 0);
});

test("vendor SLA compliance uses each work order's own priority target", () => {
  const [scorecard] = buildVendorScorecards([
    // 6h on a routine job (72h target) — comfortably within.
    order({ vendorId: "v1", priority: "routine", reportedAt: hoursAgo(30), completedAt: hoursAgo(24) }),
    // The same 6h on an emergency (4h target) — a breach.
    order({ vendorId: "v1", priority: "emergency", reportedAt: hoursAgo(30), completedAt: hoursAgo(24) }),
  ]);
  assert.equal(scorecard.slaCompliancePct, 50);
});

test("unassigned work is left out of vendor scorecards rather than attributed to nobody", () => {
  const scorecards = buildVendorScorecards([order({ vendorId: null }), order({ vendorId: "v1" })]);
  assert.equal(scorecards.length, 1);
  assert.equal(scorecards[0].vendorId, "v1");
});

test("summary separates median from mean, since one stalled job skews the mean", () => {
  const summary = summarizeMaintenance(
    [
      order({ reportedAt: hoursAgo(10), completedAt: hoursAgo(8) }), // 2h
      order({ reportedAt: hoursAgo(10), completedAt: hoursAgo(7) }), // 3h
      order({ reportedAt: hoursAgo(500), completedAt: hoursAgo(1) }), // 499h
    ],
    ASOF,
  );
  assert.equal(summary.medianHoursToComplete, 3);
  assert.equal(summary.meanHoursToComplete, 168);
  assert.equal(summary.completedCount, 3);
});

test("summary reports how much spend it cannot see", () => {
  const summary = summarizeMaintenance(
    [order({ actualCostCents: 25_000 }), order({ actualCostCents: null })],
    ASOF,
  );
  assert.equal(summary.totalActualCostCents, 25_000);
  assert.equal(summary.workOrdersMissingCost, 1);
});

test("oldest open work order is measured in days, and null when nothing is open", () => {
  assert.equal(
    summarizeMaintenance([order({ status: "reported", reportedAt: daysAgo(12), completedAt: null })], ASOF).oldestOpenDays,
    12,
  );
  assert.equal(summarizeMaintenance([order()], ASOF).oldestOpenDays, null);
});

test("category breakdown surfaces a concentration a total would hide", () => {
  const rows = summarizeByCategory([
    order({ category: "hvac", actualCostCents: 80_000 }),
    order({ category: "hvac", actualCostCents: 90_000 }),
    order({ category: "plumbing", actualCostCents: 10_000 }),
  ]);
  assert.equal(rows[0].category, "hvac");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].sharePct, 66.67);
  assert.equal(rows[0].totalCostCents, 170_000);
});

test("cost per unit is null rather than a division by zero units", () => {
  assert.equal(costPerUnitCents([order({ actualCostCents: 100_000 })], 4), 25_000);
  assert.equal(costPerUnitCents([order({ actualCostCents: 100_000 })], 0), null);
});

test("callback suggestions are proposals only — same unit, same trade, inside the window", () => {
  const original = order({ id: "wo-a", unitId: "u1", category: "hvac", completedAt: daysAgo(20) });
  const nearby = order({ id: "wo-b", unitId: "u1", category: "hvac", reportedAt: daysAgo(5), completedAt: null, status: "reported" });
  const differentTrade = order({ id: "wo-c", unitId: "u1", category: "plumbing", reportedAt: daysAgo(5), completedAt: null, status: "reported" });
  const tooLate = order({ id: "wo-d", unitId: "u1", category: "hvac", reportedAt: daysAgo(-40), completedAt: null, status: "reported" });

  const suggestions = suggestCallbacks([original, nearby, differentTrade, tooLate], 30);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].candidateWorkOrderId, "wo-b");
  assert.equal(suggestions[0].possibleOriginalWorkOrderId, "wo-a");
  assert.equal(suggestions[0].daysAfterCompletion, 15);

  // The crucial property: a suggestion changes no metric. First-time-fix over
  // the same set is unaffected, because nothing was linked.
  assert.equal(firstTimeFixPct([original, nearby, differentTrade, tooLate]), 100);
});

test("a work order already linked as a callback is not re-suggested", () => {
  const original = order({ id: "wo-a", unitId: "u1", category: "hvac", completedAt: daysAgo(20) });
  const linked = order({ id: "wo-b", unitId: "u1", category: "hvac", reportedAt: daysAgo(5), callbackOfWorkOrderId: "wo-a" });
  assert.deepEqual(suggestCallbacks([original, linked], 30), []);
});

test("every priority appears in the SLA table, including ones with no work", () => {
  const rows = summarizeSlaCompliance([], ASOF);
  const priorities = rows.map((row) => row.priority).sort();
  assert.deepEqual(priorities, ["emergency", "preventive", "routine", "urgent"] as WorkOrderPriority[]);
  assert.ok(rows.every((row) => row.compliancePct === null));
});
