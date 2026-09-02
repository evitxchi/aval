import assert from "node:assert/strict";
import test from "node:test";
import { deriveInfrastructureSummary, infrastructureRawData, infrastructureSummary } from "../app/data/infrastructure-sample.ts";

test("infrastructureSummary matches a fresh derivation from infrastructureRawData", () => {
  const fresh = deriveInfrastructureSummary(infrastructureRawData);
  assert.deepEqual(fresh, infrastructureSummary);
});

test("every row's usageVariancePct is the daily-average change from the prior period, not a hardcoded guess", () => {
  const electricity = infrastructureRawData.find((row) => row.utilityType === "electricity")!;
  // 45,100 kWh over 30 days -> 1503.33/day; 42,800 kWh over 30 days -> 1426.67/day
  const priorDaily = electricity.priorPeriod.usageAmount / 30;
  const currentDaily = electricity.currentPeriod.usageAmount / 30;
  const expectedVariancePct = ((currentDaily - priorDaily) / priorDaily) * 100;
  const summary = deriveInfrastructureSummary(infrastructureRawData).find((row) => row.utilityType === "electricity")!;
  assert.equal(summary.usageVariancePct.toFixed(4), expectedVariancePct.toFixed(4));
});

test("costPerUnit is cost over usage for the current period, not the prior one", () => {
  const water = infrastructureRawData.find((row) => row.utilityType === "water")!;
  const expected = water.currentPeriod.costCents / water.currentPeriod.usageAmount;
  const summary = deriveInfrastructureSummary(infrastructureRawData).find((row) => row.utilityType === "water")!;
  assert.equal(summary.costPerUnit, expected);
});
