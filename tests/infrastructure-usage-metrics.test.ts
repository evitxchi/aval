import assert from "node:assert/strict";
import test from "node:test";
import { annualizedUsage, averageDailyUsage, compareBaselineToReporting, costPerUsageUnit, usageIntensityPerSqft, usageVariancePct } from "../lib/infrastructure/usage-metrics.ts";

test("costPerUsageUnit divides cost by usage", () => {
  assert.equal(costPerUsageUnit({ costCents: 15_000, usageAmount: 1_000 }), 15);
});

test("usageIntensityPerSqft divides usage by square footage", () => {
  assert.equal(usageIntensityPerSqft(5_000, 2_500), 2);
});

test("usageVariancePct is a plain percent-change, matching sample.ts's deriveRelativeDeltaPct shape", () => {
  assert.equal(usageVariancePct(110, 100), 10);
  assert.equal(usageVariancePct(90, 100), -10);
});

test("averageDailyUsage divides usage by the period's day count", () => {
  const period = { usageAmount: 3000, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-01-31T00:00:00Z") };
  assert.equal(averageDailyUsage(period), 100);
});

test("compareBaselineToReporting normalizes both periods to a daily average before comparing", () => {
  const baseline = { usageAmount: 3100, periodStart: new Date("2025-01-01T00:00:00Z"), periodEnd: new Date("2025-02-01T00:00:00Z") }; // 31 days -> 100/day
  const reporting = { usageAmount: 2800, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-01-29T00:00:00Z") }; // 28 days -> 100/day
  const comparison = compareBaselineToReporting(baseline, reporting);
  assert.equal(comparison.baselineDailyAverage.toFixed(4), "100.0000");
  assert.equal(comparison.reportingDailyAverage.toFixed(4), "100.0000");
  assert.equal(comparison.variancePct.toFixed(2), "0.00");
});

test("annualizedUsage sums only bills within the trailing 365 days of asOf", () => {
  const asOf = new Date("2026-06-01T00:00:00Z");
  const bills = [
    { usageAmount: 100, periodStart: new Date("2026-05-01T00:00:00Z"), periodEnd: new Date("2026-05-31T00:00:00Z") },
    { usageAmount: 200, periodStart: new Date("2025-07-01T00:00:00Z"), periodEnd: new Date("2025-07-31T00:00:00Z") },
    { usageAmount: 300, periodStart: new Date("2024-01-01T00:00:00Z"), periodEnd: new Date("2024-01-31T00:00:00Z") }, // outside the window
  ];
  assert.equal(annualizedUsage(bills, asOf), 300);
});
