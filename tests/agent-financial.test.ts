import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_THRESHOLDS,
  DAILY_ORG_LIMIT_CENTS,
  approvalTierFor,
  idempotencyKey,
  validateFinancialArguments,
  withinDailyLimit,
} from "../lib/agents/financial.ts";
import { getTool } from "../lib/agents/registry.ts";

/**
 * No tool moves money yet, so every test here runs against a declared
 * descriptor. That is deliberate: these checks have to be correct *before* the
 * first payment tool exists, because the first time they matter is the first
 * time they are wrong.
 */

const PAYMENT = getTool("issue_payment")!;

test("a well-formed proposal passes", () => {
  assert.equal(validateFinancialArguments(PAYMENT, { amount_cents: 124_500, currency: "USD" }), null);
});

test("an amount that is not a whole number of cents is refused", () => {
  // The realistic bug is a scale error: dollars sent where cents were
  // expected. Rounding it would turn a 100x mistake into a silent one.
  for (const amount of [45.5, 0.1, 1_000.0001]) {
    assert.match(validateFinancialArguments(PAYMENT, { amount_cents: amount, currency: "USD" }) ?? "", /whole number/);
  }
});

test("zero, negative and non-finite amounts are refused", () => {
  for (const amount of [0, -1, -450_000, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.notEqual(validateFinancialArguments(PAYMENT, { amount_cents: amount, currency: "USD" }), null, `${amount} should be refused`);
  }
});

test("an amount above the hard ceiling is refused before any approval is considered", () => {
  const over = APPROVAL_THRESHOLDS.HARD_CEILING_CENTS + 1;
  assert.match(validateFinancialArguments(PAYMENT, { amount_cents: over, currency: "USD" }) ?? "", /hard ceiling/);
  assert.equal(approvalTierFor(over), "refused");
});

test("a currency outside the allow-list is refused", () => {
  for (const currency of ["EUR", "BTC", "usd", "", "US"]) {
    assert.notEqual(validateFinancialArguments(PAYMENT, { amount_cents: 1000, currency }), null, `"${currency}" should be refused`);
  }
  assert.equal(validateFinancialArguments(PAYMENT, { amount_cents: 1000, currency: "MXN" }), null);
});

test("a missing or wrongly-typed amount is refused rather than coerced", () => {
  for (const amount of [undefined, null, "45000", {}, []]) {
    assert.notEqual(validateFinancialArguments(PAYMENT, { amount_cents: amount, currency: "USD" }), null);
  }
});

test("no amount currently executes without a person, because the automatic band is empty", () => {
  assert.equal(APPROVAL_THRESHOLDS.AUTOMATIC_MAX_CENTS, 0);
  for (const amount of [1, 100, 4_999, 50_000]) {
    assert.notEqual(approvalTierFor(amount), "automatic", `${amount} must not be automatic`);
  }
});

test("thresholds tier by amount, and every amount maps to some tier", () => {
  assert.equal(approvalTierFor(APPROVAL_THRESHOLDS.ELEVATED_MIN_CENTS), "single_approver");
  assert.equal(approvalTierFor(APPROVAL_THRESHOLDS.ELEVATED_MIN_CENTS + 1), "elevated_approver");
  assert.equal(approvalTierFor(APPROVAL_THRESHOLDS.HARD_CEILING_CENTS), "elevated_approver");
  for (const amount of [-1, 0, 1, 49_999, 50_001, 9_999_999, Number.NaN]) {
    assert.ok(["automatic", "single_approver", "elevated_approver", "refused"].includes(approvalTierFor(amount)));
  }
});

test("the idempotency key is derived only from task, step and tool", () => {
  // Stability is the whole property: a retried step must recompute the exact
  // same key, so a timestamp or a random component here would silently permit
  // the duplicate payment this exists to prevent.
  const first = idempotencyKey("task_283", 4, "issue_payment");
  assert.equal(first, "issue_payment:task_283:step_4");
  assert.equal(idempotencyKey("task_283", 4, "issue_payment"), first);
  assert.notEqual(idempotencyKey("task_283", 5, "issue_payment"), first);
  assert.notEqual(idempotencyKey("task_284", 4, "issue_payment"), first);
  assert.notEqual(idempotencyKey("task_283", 4, "authorize_vendor_spend"), first);
});

test("the rolling daily ceiling is enforced on the total, not the single amount", () => {
  assert.equal(withinDailyLimit(0, DAILY_ORG_LIMIT_CENTS).ok, true);
  assert.equal(withinDailyLimit(DAILY_ORG_LIMIT_CENTS, 1).ok, false);
  // The failure this catches: many individually-approvable amounts adding up.
  assert.equal(withinDailyLimit(DAILY_ORG_LIMIT_CENTS - 100, 101).ok, false);
});

test("every financial descriptor names fields that its validator actually reads", () => {
  for (const name of ["issue_payment", "authorize_vendor_spend"]) {
    const tool = getTool(name)!;
    assert.ok(tool.financial, `${name} should declare financial rules`);
    assert.equal(tool.riskLevel, "critical");
    assert.equal(tool.requiresApproval, true);
    assert.equal(tool.maxRetries, 0, `${name} must never retry`);
    // A validator that reads a field the descriptor does not name would pass
    // everything; this asserts the two agree.
    const problem = validateFinancialArguments(tool, { [tool.financial!.amountField]: 1000, [tool.financial!.currencyField]: tool.financial!.allowedCurrencies[0] });
    assert.equal(problem, null);
  }
});
