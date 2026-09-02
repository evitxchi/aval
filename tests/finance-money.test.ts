import assert from "node:assert/strict";
import test from "node:test";
import { allocateMoney, decimalToCents, formatMoney, moneyToDecimal, sumMoney, toMoney } from "../lib/finance/money.ts";

test("toMoney/moneyToDecimal round-trips a cents amount", () => {
  assert.equal(moneyToDecimal(toMoney(500, "USD")), "5.00");
});

test("sumMoney adds same-currency amounts", () => {
  const total = sumMoney(
    [
      { amountCents: 100, currency: "USD" },
      { amountCents: 250, currency: "USD" },
    ],
    "USD",
  );
  assert.equal(moneyToDecimal(total), "3.50");
});

test("sumMoney throws on a mismatched currency rather than silently coercing it", () => {
  assert.throws(
    () =>
      sumMoney(
        [
          { amountCents: 100, currency: "USD" },
          { amountCents: 250, currency: "MXN" },
        ],
        "USD",
      ),
    /expected every amount in USD, found MXN/,
  );
});

test("allocateMoney splits a total into proportional shares that sum back to it exactly", () => {
  const shares = allocateMoney(toMoney(100, "USD"), [1, 1, 1]);
  const decimals = shares.map(moneyToDecimal);
  assert.deepEqual(decimals.sort(), ["0.33", "0.33", "0.34"]);
});

test("formatMoney renders the market-appropriate symbol and grouping", () => {
  assert.equal(formatMoney(123_456, "USD"), "$1,234.56");
  assert.equal(formatMoney(123_456, "MXN"), "MX$1,234.56");
});

test("decimalToCents rounds to the nearest cent", () => {
  assert.equal(decimalToCents(10.5), 1050);
  assert.equal(decimalToCents(10.005), 1001);
});
