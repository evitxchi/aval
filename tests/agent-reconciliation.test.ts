import assert from "node:assert/strict";
import test from "node:test";
import { compareFinancialState, projectProviderReport, reconciliationBackoffMs, validateFinancialToolResult } from "../lib/agents/reconciliation-rules.ts";

const expected = {
  externalTransactionId: "tr_123",
  amountCents: 12_500,
  currency: "USD",
  accountFingerprint: "sha256-account",
};

test("an independent provider read-back settles only an exact match", () => {
  assert.deepEqual(compareFinancialState(expected, {
    externalTransactionId: "tr_123", status: "settled", amountCents: 12_500,
    currency: "usd", accountFingerprint: "sha256-account",
  }), { status: "matched", operationStatus: "settled" });
});

test("every financially material mismatch is explicit", () => {
  const cases = [
    [{ externalTransactionId: "tr_other" }, "external_id_mismatch"],
    [{ amountCents: 12_501 }, "amount_mismatch"],
    [{ currency: "MXN" }, "currency_mismatch"],
    [{ accountFingerprint: "other" }, "account_mismatch"],
  ] as const;
  for (const [override, code] of cases) {
    const observed = { ...expected, status: "settled" as const, ...override };
    assert.deepEqual(compareFinancialState(expected, observed), { status: "mismatch", code });
  }
});

test("a reversal requires manual review and pending remains pending", () => {
  assert.deepEqual(compareFinancialState(expected, { ...expected, status: "reversed" }), { status: "manual_review", operationStatus: "reversed", code: "external_reversal" });
  assert.deepEqual(compareFinancialState(expected, { ...expected, status: "pending" }), { status: "pending" });
});

test("provider results cannot be called successful without a read-back id", () => {
  assert.deepEqual(validateFinancialToolResult({ external_transaction_id: "tr_123", status: "submitted" }), { ok: true, externalTransactionId: "tr_123", status: "submitted" });
  for (const invalid of [{ status: "settled" }, { external_transaction_id: "tr_1", status: "paid" }, null]) {
    assert.equal(validateFinancialToolResult(invalid).ok, false);
  }
});

test("a provider's own settled claim remains submitted until independent reconciliation", () => {
  assert.deepEqual(projectProviderReport("settled"), {
    operationStatus: "submitted",
    eventKind: "provider_reported_settled",
  });
  assert.deepEqual(projectProviderReport("submitted"), {
    operationStatus: "submitted",
    eventKind: "submitted",
  });
});

test("reconciliation backoff starts at one minute and caps at six hours", () => {
  assert.equal(reconciliationBackoffMs(1), 60_000);
  assert.equal(reconciliationBackoffMs(2), 120_000);
  assert.equal(reconciliationBackoffMs(100), 6 * 60 * 60_000);
});
