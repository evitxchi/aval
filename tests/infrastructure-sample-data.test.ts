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

import {
  assetCondition, buildingAssets, buildingAssetsRawData, capitalForecast, complianceItems,
  deriveBuildingAssets, deriveCapitalForecast, deriveCompliance, deriveFixtureLoad,
  derivePreventiveTasks, dueStatus, fixtureLoad, FIXTURE_UNIT_TABLE_CEILING, INFRA_TODAY,
  preventiveTasks, totalAnnualReserveCents,
} from "../app/data/infrastructure-sample.ts";

test("published asset rows match a fresh derivation from their raw inputs", () => {
  assert.deepEqual(deriveBuildingAssets(buildingAssetsRawData, INFRA_TODAY), buildingAssets);
});

test("an asset's annual reserve is its replacement cost spread over its service life", () => {
  const elevator = buildingAssets.find((asset) => asset.id === "a3")!;
  const raw = buildingAssetsRawData.find((asset) => asset.id === "a3")!;
  assert.equal(elevator.annualReserveCents, Math.round(raw.replacementCostCents / raw.expectedLifeYears));
});

test("condition bands are read off consumed service life, not assigned by hand", () => {
  assert.equal(assetCondition(10), "good");
  assert.equal(assetCondition(70), "monitor");
  assert.equal(assetCondition(90), "plan");
  assert.equal(assetCondition(100), "urgent");
  assert.equal(assetCondition(140), "urgent");
});

test("totalAnnualReserveCents sums every tracked asset's own contribution", () => {
  assert.equal(totalAnnualReserveCents(), buildingAssets.reduce((sum, asset) => sum + asset.annualReserveCents, 0));
});

test("due status treats anything past its date as overdue and 30 days out as due soon", () => {
  assert.equal(dueStatus(-1), "overdue");
  assert.equal(dueStatus(0), "dueSoon");
  assert.equal(dueStatus(30), "dueSoon");
  assert.equal(dueStatus(31), "current");
});

test("compliance rows are sorted soonest-first so overdue items surface at the top", () => {
  const days = complianceItems.map((item) => item.daysUntilDue);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.equal(complianceItems[0].status, "overdue");
});

test("a compliance due date is its last completion plus its own cadence", () => {
  const fresh = deriveCompliance(undefined, INFRA_TODAY);
  for (const row of fresh) {
    const expected = new Date(row.lastCompleted);
    expected.setMonth(expected.getMonth() + row.cadenceMonths);
    assert.equal(row.dueDate.getTime(), expected.getTime());
  }
});

test("preventive tasks are sorted soonest-first and derive days-until-due from cadence", () => {
  const days = preventiveTasks.map((task) => task.daysUntilDue);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.deepEqual(derivePreventiveTasks(), preventiveTasks);
});

test("the capital forecast buckets each asset into the year its service life expires", () => {
  const forecast = deriveCapitalForecast(buildingAssets, INFRA_TODAY);
  for (const year of forecast) {
    const expected = year.assetIds.reduce((sum, id) => sum + buildingAssets.find((asset) => asset.id === id)!.replacementCostCents, 0);
    assert.equal(year.totalCents, expected);
  }
  // Every asset is accounted for exactly once across the horizon.
  const placed = forecast.flatMap((year) => year.assetIds);
  assert.equal(new Set(placed).size, placed.length);
  assert.equal(placed.length, buildingAssets.length);
});

test("capital already past due is carried into the first column rather than dropped", () => {
  const overdue = [{ ...buildingAssets[0], id: "past", replacementYear: INFRA_TODAY.getFullYear() - 4, replacementCostCents: 1_000_000 }];
  const forecast = deriveCapitalForecast(overdue, INFRA_TODAY);
  assert.deepEqual(forecast[0].assetIds, ["past"]);
  assert.equal(forecast[0].totalCents, 1_000_000);
});

test("published forecast matches a fresh derivation", () => {
  assert.deepEqual(deriveCapitalForecast(buildingAssets, INFRA_TODAY), capitalForecast);
});

test("fixture load totals each fixture's own published unit value", () => {
  const fresh = deriveFixtureLoad();
  assert.deepEqual(fresh, fixtureLoad);
  const summed = fresh.fixtures.reduce((total, fixture) => total + fixture.unitsTotal, 0);
  assert.equal(fresh.totalUnits, Math.round(summed * 10) / 10);
});

test("a load past the band table is flagged rather than reported as a pipe size", () => {
  assert.equal(fixtureLoad.totalUnits > FIXTURE_UNIT_TABLE_CEILING, true);
  assert.equal(fixtureLoad.beyondTableRange, true);
  const small = deriveFixtureLoad([{ type: "lavatory", count: 4 }]);
  assert.equal(small.beyondTableRange, false);
});
