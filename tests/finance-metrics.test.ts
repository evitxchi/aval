import assert from "node:assert/strict";
import test from "node:test";
import {
  amortizationSchedule,
  breakEvenOccupancyPct,
  capRatePct,
  cashOnCashReturnPct,
  debtServiceCoverageRatio,
  grossRentMultiplier,
  internalRateOfReturnPct,
  monthlyMortgagePayment,
  netOperatingIncome,
  netPresentValue,
  operatingExpenseRatioPct,
} from "../lib/finance/metrics.ts";

test("netOperatingIncome subtracts operating expenses from effective gross income", () => {
  assert.equal(netOperatingIncome(150_000, 60_000), 90_000);
});

test("capRatePct expresses NOI over property value as a percent", () => {
  assert.equal(capRatePct(90_000, 1_500_000), 6);
});

test("cashOnCashReturnPct expresses pre-tax cash flow over cash invested as a percent", () => {
  assert.equal(cashOnCashReturnPct(24_000, 400_000), 6);
});

test("debtServiceCoverageRatio is a ratio, not a percent", () => {
  assert.equal(debtServiceCoverageRatio(90_000, 72_000), 1.25);
});

test("operatingExpenseRatioPct expresses opex over EGI as a percent", () => {
  assert.equal(operatingExpenseRatioPct(60_000, 150_000), 40);
});

test("breakEvenOccupancyPct combines opex and debt service against gross potential income", () => {
  assert.equal(breakEvenOccupancyPct(60_000, 72_000, 200_000), 66);
});

test("grossRentMultiplier is price over annual gross rent", () => {
  assert.equal(grossRentMultiplier(1_500_000, 180_000).toFixed(4), (1_500_000 / 180_000).toFixed(4));
});

test("netPresentValue discounts each period's cash flow", () => {
  assert.equal(netPresentValue(10, [-1000, 300, 300, 300, 300, 300]).toFixed(4), "137.2360");
});

test("internalRateOfReturnPct finds the rate that zeroes NPV, matching a bisection reference", () => {
  const irr = internalRateOfReturnPct([-1000, 300, 300, 300, 300, 300]);
  assert.equal(irr.toFixed(4), "15.2382");
  assert.equal(netPresentValue(irr, [-1000, 300, 300, 300, 300, 300]).toFixed(2), "0.00");
});

test("internalRateOfReturnPct rejects cash flows with no sign change", () => {
  assert.throws(() => internalRateOfReturnPct([100, 200, 300]), /negative and one positive/);
});

test("monthlyMortgagePayment matches the standard fixed-rate amortization formula", () => {
  assert.equal(monthlyMortgagePayment(200_000, 6, 360).toFixed(4), "1199.1011");
});

test("amortizationSchedule fully retires the loan and each row's math is internally consistent", () => {
  const schedule = amortizationSchedule(200_000, 6, 360);
  assert.equal(schedule.length, 360);
  assert.equal(schedule.at(-1)?.balance, 0);
  assert.equal(schedule[0].interestPaid.toFixed(2), "1000.00");
  assert.equal(schedule[0].principalPaid.toFixed(4), "199.1011");
  for (const row of schedule) {
    assert.equal((row.principalPaid + row.interestPaid).toFixed(6), row.payment.toFixed(6));
  }
});
