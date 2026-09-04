import assert from "node:assert/strict";
import test from "node:test";
import { centsToDollars, dollarsToCents, parseAccountIds, parseCurrencies } from "../lib/agents/financial-policy-form.ts";

test("business-entered dollar limits become exact integer cents", () => {
  assert.equal(dollarsToCents("1"), 100);
  assert.equal(dollarsToCents("1.2"), 120);
  assert.equal(dollarsToCents("1.23"), 123);
  assert.equal(dollarsToCents("25,000.00"), 2_500_000);
  for (const invalid of ["", "0", "-1", "1.234", "1e4", "$10", "NaN"]) assert.equal(dollarsToCents(invalid), null);
});

test("stored cents render without losing scale", () => {
  assert.equal(centsToDollars(1), "0.01");
  assert.equal(centsToDollars(2_500_000), "25000.00");
  assert.equal(centsToDollars(-1), "");
});

test("currencies normalize and deduplicate at the form boundary", () => {
  assert.deepEqual(parseCurrencies("usd, MXN usd\nEUR"), ["USD", "MXN", "EUR"]);
});

test("destination ids stay exact while blank and duplicate lines disappear", () => {
  assert.deepEqual(parseAccountIds(" acct_1 \nVENDOR-case-sensitive\nacct_1\n"), ["acct_1", "VENDOR-case-sensitive"]);
});
