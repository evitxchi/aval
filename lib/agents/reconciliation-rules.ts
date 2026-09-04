/** Pure reconciliation comparison, intentionally independent of storage/provider code. */

export type ExternalFinancialState = {
  externalTransactionId: string;
  status: "pending" | "settled" | "reversed";
  amountCents: number;
  currency: string;
  accountFingerprint: string;
};

export type ExpectedFinancialState = {
  externalTransactionId: string | null;
  amountCents: number;
  currency: string;
  accountFingerprint: string;
};

export type ReconciliationVerdict =
  | { status: "pending" }
  | { status: "matched"; operationStatus: "settled" }
  | { status: "manual_review"; operationStatus: "reversed"; code: "external_reversal" }
  | { status: "mismatch"; code: "external_id_mismatch" | "amount_mismatch" | "currency_mismatch" | "account_mismatch" };

export function compareFinancialState(expected: ExpectedFinancialState, observed: ExternalFinancialState): ReconciliationVerdict {
  if (expected.externalTransactionId && expected.externalTransactionId !== observed.externalTransactionId) {
    return { status: "mismatch", code: "external_id_mismatch" };
  }
  if (expected.amountCents !== observed.amountCents) return { status: "mismatch", code: "amount_mismatch" };
  if (expected.currency !== observed.currency.toUpperCase()) return { status: "mismatch", code: "currency_mismatch" };
  if (expected.accountFingerprint !== observed.accountFingerprint) return { status: "mismatch", code: "account_mismatch" };
  if (observed.status === "reversed") return { status: "manual_review", operationStatus: "reversed", code: "external_reversal" };
  if (observed.status === "settled") return { status: "matched", operationStatus: "settled" };
  return { status: "pending" };
}

export function reconciliationBackoffMs(attempt: number): number {
  // 1m, 2m, 4m … capped at 6h. A bad provider cannot turn the cron into a
  // thundering herd, and new operations converge quickly.
  return Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, Math.min(attempt - 1, 9)));
}

export function validateFinancialToolResult(value: unknown):
  | { ok: true; externalTransactionId: string; status: "submitted" | "settled" }
  | { ok: false; reason: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "The financial provider returned no structured result." };
  const result = value as Record<string, unknown>;
  if (typeof result.external_transaction_id !== "string" || result.external_transaction_id.length < 3 || result.external_transaction_id.length > 200) {
    return { ok: false, reason: "The provider result did not include a valid external transaction id." };
  }
  if (result.status !== "submitted" && result.status !== "settled") {
    return { ok: false, reason: "The provider result did not declare submitted or settled status." };
  }
  return { ok: true, externalTransactionId: result.external_transaction_id, status: result.status };
}

/**
 * A provider may report "settled", but that claim is evidence to reconcile,
 * not authority to settle Aval's ledger. Only compareFinancialState's exact
 * independent read-back can return operationStatus "settled".
 */
export function projectProviderReport(status: "submitted" | "settled"): {
  operationStatus: "submitted";
  eventKind: "submitted" | "provider_reported_settled";
} {
  return {
    operationStatus: "submitted",
    eventKind: status === "settled" ? "provider_reported_settled" : "submitted",
  };
}
