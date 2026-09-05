/**
 * Pure mapping rules for QuickBooks Online data.
 *
 * Separated from the HTTP client for the same reason `import-plan` is
 * separated from `import-apply`: these are the decisions with sharp edges, and
 * a rule nobody can run tests against is a rule nobody can trust.
 *
 * Both rules here fail silently when wrong. A misfiled account type distorts
 * NOI; an inverted posting direction produces a P&L that is exactly backwards.
 * Neither looks broken — every figure remains a plausible dollar amount.
 */

import { decimalToCents } from "../finance/money.ts";
import type { GlAccountType } from "../operations/types.ts";

/**
 * QuickBooks' account taxonomy, mapped onto Aval's six types.
 *
 * Deliberately exhaustive rather than pattern-matched: QuickBooks adds account
 * types, and a regex that happens to catch a new one is worse than a lookup
 * that visibly does not.
 */
export const QBO_ACCOUNT_TYPE_MAP: Readonly<Record<string, GlAccountType>> = {
  "Income": "income",
  "Other Income": "income",
  "Expense": "operating_expense",
  "Other Expense": "operating_expense",
  "Cost of Goods Sold": "operating_expense",
  "Bank": "asset",
  "Accounts Receivable": "asset",
  "Other Current Asset": "asset",
  "Fixed Asset": "asset",
  "Other Asset": "asset",
  "Accounts Payable": "liability",
  "Credit Card": "liability",
  "Other Current Liability": "liability",
  "Long Term Liability": "liability",
  "Equity": "equity",
};

/** Null for anything unrecognized, so the caller skips and reports the row. */
export function mapAccountType(qboType: string): GlAccountType | null {
  return QBO_ACCOUNT_TYPE_MAP[qboType] ?? null;
}

/** Types whose natural balance is a credit. Everything else is a debit type. */
const CREDIT_NATURAL: ReadonlySet<GlAccountType> = new Set(["income", "liability", "equity"]);

/**
 * A journal line's contribution, positive in the account's natural direction.
 *
 * QuickBooks sends one positive `Amount` plus a `PostingType`; Aval's
 * `profitAndLoss` sums `amountCents` directly, so the direction has to be
 * resolved here rather than carried as a sign convention downstream.
 *
 * Null when the line cannot be trusted: an unknown posting type, a non-finite
 * amount, or more than two decimal places. `decimalToCents` is exact for every
 * two-decimal value but turns 1.005 into 100 rather than 101, so a third
 * decimal means something unexpected arrived, and rounding it would move money
 * without saying so.
 */
export function signedAmountCents(
  accountType: GlAccountType,
  postingType: string,
  amount: number,
): number | null {
  if (postingType !== "Debit" && postingType !== "Credit") return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) return null;

  const cents = decimalToCents(amount);
  const naturallyCredit = CREDIT_NATURAL.has(accountType);
  const isCredit = postingType === "Credit";
  return naturallyCredit === isCredit ? cents : -cents;
}
