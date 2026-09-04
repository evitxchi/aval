import assert from "node:assert/strict";
import test from "node:test";
import { countBySeverity, deriveInsights, INSIGHT_THRESHOLDS, type InsightInputs } from "../lib/operations/insights.ts";

/**
 * These pin the two properties that make an insight worth showing someone:
 * it fires only when the data supports it, and it can say what it was computed
 * from. The empty case matters most — an empty workspace producing a
 * reassuring "nothing wrong" is the single most damaging output this module
 * could have.
 *
 * The input types are `import type` only, so this runs without a D1 binding.
 */

const EMPTY: InsightInputs = { portfolio: null, leasing: null, maintenance: null, accounting: null, conflicts: [] };

/** Only the fields a given rule reads are populated; the rest are cast away. */
function inputs(partial: Partial<InsightInputs>): InsightInputs {
  return { ...EMPTY, ...partial };
}

test("a workspace with nothing connected produces no insights at all", () => {
  assert.deepEqual(deriveInsights(EMPTY), []);
});

test("severe delinquency fires on months-of-rent owed and names the leases", () => {
  const found = deriveInsights(
    inputs({
      accounting: {
        delinquents: [
          { leaseId: "lease-a", monthsOfRentOwed: 2.4, balanceCents: 480_000, oldestDaysPastDue: 96 },
          { leaseId: "lease-b", monthsOfRentOwed: 0.5, balanceCents: 90_000, oldestDaysPastDue: 12 },
        ],
        expenseLines: [],
      } as unknown as InsightInputs["accounting"],
    }),
  );
  const insight = found.find((item) => item.kind === "delinquency_severe");
  assert.equal(insight?.severity, "critical");
  // Only the account over the threshold; the 0.5-month one is a late payment.
  assert.deepEqual(insight?.evidence.entityIds, ["lease-a"]);
  assert.ok(insight?.figures.includes(480_000));
  assert.ok(insight?.detail.includes("$4,800.00"));
});

test("collection rate escalates from high to critical as it falls", () => {
  const at = (collectedCents: number) =>
    deriveInsights(
      inputs({
        accounting: {
          delinquents: [],
          expenseLines: [],
          collections: {
            billedCents: 1_000_000,
            collectedCents,
            outstandingCents: 1_000_000 - collectedCents,
            collectionRatePct: (collectedCents / 1_000_000) * 100,
          },
        } as unknown as InsightInputs["accounting"],
      }),
    ).find((item) => item.kind === "collection_rate_low");

  assert.equal(at(980_000), undefined); // 98% — above the flag threshold
  assert.equal(at(900_000)?.severity, "high");
  assert.equal(at(800_000)?.severity, "critical");
});

test("expiration concentration fires on the share of active leases, not a raw count", () => {
  const build = (leaseCount: number, activeLeaseCount: number) =>
    deriveInsights(
      inputs({
        leasing: {
          activeLeaseCount,
          expirations: { schedule: [{ month: "2026-11", leaseCount, rentAtRiskCents: leaseCount * 200_000 }], monthToMonthCount: 0 },
        } as unknown as InsightInputs["leasing"],
      }),
    ).find((item) => item.kind === "expiration_concentration");

  // Six leases in one month is nothing across 100 units and a lot across 20.
  assert.equal(build(6, 100), undefined);
  assert.equal(build(6, 20)?.severity, "medium");
  assert.equal(build(8, 20)?.severity, "high");
});

test("the funnel bottleneck stays quiet below the minimum sample size", () => {
  const build = (totalLeads: number) =>
    deriveInsights(
      inputs({
        leasing: {
          activeLeaseCount: 0,
          expirations: { schedule: [], monthToMonthCount: 0 },
          health: {
            totalLeads,
            leadToLeaseConversionPct: 5,
            weakestTransition: { from: "toured", to: "applied", conversionPct: 12 },
          },
        } as unknown as InsightInputs["leasing"],
      }),
    ).find((item) => item.kind === "funnel_bottleneck");

  // Two leads that both stalled is not a funnel problem, it is two leads.
  assert.equal(build(2), undefined);
  assert.equal(build(INSIGHT_THRESHOLDS.minLeadsForFunnel)?.severity, "high");
});

test("an open SLA breach on an emergency is critical and states the target it used", () => {
  const found = deriveInsights(
    inputs({
      maintenance: {
        sla: [
          { priority: "emergency", targetHours: 4, openBreachedCount: 2, compliancePct: 100, completedCount: 3, withinTargetCount: 3, medianHoursToComplete: 2 },
          { priority: "routine", targetHours: 72, openBreachedCount: 0, compliancePct: 90, completedCount: 10, withinTargetCount: 9, medianHoursToComplete: 20 },
        ],
        vendors: [],
      } as unknown as InsightInputs["maintenance"],
    }),
  );
  const breaches = found.filter((item) => item.kind === "sla_breach_open");
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].severity, "critical");
  assert.ok(breaches[0].detail.includes("4-hour target"));
  // Says out loud that the bar is Aval's, not the workspace's contract.
  assert.ok(breaches[0].detail.includes("Aval default"));
});

test("vendor rules need a minimum sample, but lapsed insurance fires immediately", () => {
  const vendor = (overrides: Record<string, unknown>) => ({
    vendorId: "v1",
    vendorName: "Northside Plumbing",
    trade: "plumbing",
    insuranceExpired: false,
    insuranceExpiresAt: null,
    assignedCount: 1,
    completedCount: 1,
    callbackCount: 1,
    firstTimeFixPct: 0,
    costVsEstimatePct: null,
    jobsWithBothCostFigures: 0,
    totalCostCents: 0,
    ...overrides,
  });

  const oneJob = deriveInsights(
    inputs({ maintenance: { sla: [], vendors: [vendor({})] } as unknown as InsightInputs["maintenance"] }),
  );
  // One callback out of one job is not a 0% first-time-fix rate worth a
  // vendor's contract.
  assert.equal(oneJob.find((item) => item.kind === "vendor_first_time_fix_low"), undefined);

  const enoughJobs = deriveInsights(
    inputs({
      maintenance: {
        sla: [],
        vendors: [vendor({ completedCount: 5, callbackCount: 2, firstTimeFixPct: 60 })],
      } as unknown as InsightInputs["maintenance"],
    }),
  );
  assert.equal(enoughJobs.find((item) => item.kind === "vendor_first_time_fix_low")?.severity, "high");

  // Compliance does not wait for a sample size.
  const lapsed = deriveInsights(
    inputs({ maintenance: { sla: [], vendors: [vendor({ insuranceExpired: true })] } as unknown as InsightInputs["maintenance"] }),
  );
  assert.equal(lapsed.find((item) => item.kind === "vendor_insurance_lapsed")?.severity, "critical");
});

test("open conflicts surface as their own finding, since figures built on them are contested", () => {
  const found = deriveInsights(
    inputs({
      conflicts: [
        { id: "c1", entityType: "unit", entityId: "u1", field: "marketRentCents", valueA: "200000", sourceA: "appfolio", valueB: "189000", sourceB: "quickbooks", status: "open", resolution: null, detectedAt: new Date(), resolvedAt: null },
      ],
    }),
  );
  const insight = found.find((item) => item.kind === "data_conflict_open");
  assert.equal(insight?.severity, "high");
  assert.deepEqual(insight?.evidence.entityIds, ["c1"]);
  assert.ok(insight?.detail.includes("kept the stored value"));
});

test("a source reporting more units than were received is a sync finding, not a vacancy one", () => {
  const found = deriveInsights(
    inputs({
      portfolio: {
        unitCountMismatches: [{ propertyId: "p1", propertyName: "Maple Court", reported: 24, actual: 18 }],
        vacancy: { overThresholdUnitIds: [], measuredUnits: 0, unmeasuredUnits: 0, averageDaysVacant: null, longestDaysVacant: null },
        rentPosition: { lossToLeaseCents: null, inPlaceRentCents: 0, lossToLeaseUnitCount: 0 },
      } as unknown as InsightInputs["portfolio"],
    }),
  );
  const insight = found.find((item) => item.kind === "sync_incomplete");
  assert.equal(insight?.module, "data");
  assert.ok(insight?.detail.includes("source says 24, 18 received"));
});

test("insights come back most severe first", () => {
  const found = deriveInsights(
    inputs({
      accounting: {
        delinquents: [{ leaseId: "lease-a", monthsOfRentOwed: 3, balanceCents: 600_000, oldestDaysPastDue: 100 }],
        expenseLines: [
          { accountId: "a1", code: "6100", name: "Utilities", amountCents: 300_000, priorAmountCents: 200_000, variancePct: 50, sharePct: 100 },
        ],
      } as unknown as InsightInputs["accounting"],
      conflicts: [
        { id: "c1", entityType: "unit", entityId: "u1", field: "rent", valueA: "1", sourceA: "a", valueB: "2", sourceB: "b", status: "open", resolution: null, detectedAt: new Date(), resolvedAt: null },
      ],
    }),
  );
  assert.deepEqual(found.map((item) => item.severity), ["critical", "high", "high"]);
  const counts = countBySeverity(found);
  assert.equal(counts.critical, 1);
  assert.equal(counts.high, 2);
  assert.equal(counts.low, 0);
});

test("every insight carries evidence and figures a reader could check", () => {
  const found = deriveInsights(
    inputs({
      accounting: {
        delinquents: [{ leaseId: "lease-a", monthsOfRentOwed: 3, balanceCents: 600_000, oldestDaysPastDue: 100 }],
        expenseLines: [],
        collections: { billedCents: 1_000_000, collectedCents: 700_000, outstandingCents: 300_000, collectionRatePct: 70 },
        utilityReconciliation: { materialDifference: true, meteredCostCents: 200_000, meteredBillCount: 2, ledgerCostCents: 150_000, differenceCents: 50_000, differencePct: 33.33, ledgerAccountCount: 1 },
      } as unknown as InsightInputs["accounting"],
    }),
  );
  assert.ok(found.length >= 3);
  for (const insight of found) {
    assert.ok(insight.figures.length > 0, `${insight.kind} has no figures`);
    assert.ok(insight.suggestedAction.length > 0, `${insight.kind} has no action`);
    assert.ok(insight.evidence.entityType.length > 0, `${insight.kind} has no evidence type`);
  }
});
