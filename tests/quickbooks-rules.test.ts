import assert from "node:assert/strict";
import test from "node:test";
import { mapAccountType, signedAmountCents } from "../lib/integrations/quickbooks-rules.ts";

/**
 * The two rules that decide whether a synced P&L is right.
 *
 * Both fail silently when wrong: a misfiled account type distorts NOI, and an
 * inverted posting direction produces a P&L that is exactly backwards. Every
 * figure still looks like a plausible dollar amount, so only a test with a
 * known expected value catches either one.
 */

test("every QuickBooks account type Aval accepts maps to a known Aval type", () => {
  const cases: Array<[string, string]> = [
    ["Income", "income"],
    ["Other Income", "income"],
    ["Expense", "operating_expense"],
    ["Other Expense", "operating_expense"],
    ["Cost of Goods Sold", "operating_expense"],
    ["Bank", "asset"],
    ["Accounts Receivable", "asset"],
    ["Other Current Asset", "asset"],
    ["Fixed Asset", "asset"],
    ["Other Asset", "asset"],
    ["Accounts Payable", "liability"],
    ["Credit Card", "liability"],
    ["Other Current Liability", "liability"],
    ["Long Term Liability", "liability"],
    ["Equity", "equity"],
  ];
  for (const [qbo, expected] of cases) {
    assert.equal(mapAccountType(qbo), expected, qbo);
  }
});

test("an unrecognized account type is rejected rather than defaulted", () => {
  // Defaulting would file the account somewhere plausible and quietly change
  // NOI. A null forces the caller to skip and report the row.
  for (const unknown of ["Inventory Asset", "", "income", "Bank Account", "Unknown"]) {
    assert.equal(mapAccountType(unknown), null, JSON.stringify(unknown));
  }
});

test("income is positive on a credit, expense is positive on a debit", () => {
  // profitAndLoss sums amountCents straight into income and expense totals, so
  // Aval's convention is positive-in-natural-direction, not signed debits.
  assert.equal(signedAmountCents("income", "Credit", 1200.5), 120050);
  assert.equal(signedAmountCents("income", "Debit", 1200.5), -120050);
  assert.equal(signedAmountCents("operating_expense", "Debit", 340.25), 34025);
  assert.equal(signedAmountCents("operating_expense", "Credit", 340.25), -34025);
});

test("balance-sheet types follow the same natural direction", () => {
  assert.equal(signedAmountCents("asset", "Debit", 10), 1000);
  assert.equal(signedAmountCents("asset", "Credit", 10), -1000);
  assert.equal(signedAmountCents("liability", "Credit", 10), 1000);
  assert.equal(signedAmountCents("equity", "Credit", 10), 1000);
});

test("a reversing entry is the exact negative of the original", () => {
  const original = signedAmountCents("income", "Credit", 987.65);
  const reversal = signedAmountCents("income", "Debit", 987.65);
  assert.equal(original! + reversal!, 0);
});

test("an amount with more than two decimals is rejected, not rounded", () => {
  // decimalToCents is Math.round(value * 100), which is exact for every
  // two-decimal value but turns 1.005 into 100 rather than 101. QuickBooks
  // returns currency at two decimals, so a third decimal means something
  // unexpected arrived and guessing at it would silently move money.
  assert.equal(signedAmountCents("income", "Credit", 1.005), null);
  assert.equal(signedAmountCents("income", "Credit", 29.925), null);
});

test("a non-finite or negative-zero amount is rejected", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MAX_VALUE]) {
    assert.equal(signedAmountCents("income", "Credit", bad), null, String(bad));
  }
});

test("an unrecognized posting type is rejected", () => {
  assert.equal(signedAmountCents("income", "credit", 10), null);
  assert.equal(signedAmountCents("income", "", 10), null);
});
