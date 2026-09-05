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

import type { ImportBatch, ImportGlAccount, ImportGlTransaction } from "../operations/import-plan.ts";

export interface QboAccount {
  Id: string;
  Name: string;
  AcctNum?: string;
  AccountType: string;
  Active?: boolean;
}

export interface QboJournalLine {
  Id?: string;
  Amount?: number;
  DetailType?: string;
  JournalEntryLineDetail?: { PostingType?: string; AccountRef?: { value?: string } };
}

export interface QboJournalEntry {
  Id: string;
  TxnDate?: string;
  Line?: QboJournalLine[];
}

export interface NormalizedQbo {
  batch: ImportBatch;
  /** Rows that could not be trusted, each with why. Never silently dropped. */
  rejected: Array<{ entity: string; externalId: string; reason: string }>;
}

/**
 * QuickBooks entities to Aval's import vocabulary.
 *
 * A rejected row never becomes a guessed row. The importer already reports
 * what it skipped and why, and this keeps that contract intact one layer up:
 * an operator reading a sync result sees a row that did not land, rather than
 * a figure that quietly moved.
 */
export function normalizeQuickbooks(input: {
  accounts: QboAccount[];
  journalEntries: QboJournalEntry[];
}): NormalizedQbo {
  const rejected: NormalizedQbo["rejected"] = [];
  const glAccounts: ImportGlAccount[] = [];
  const typeById = new Map<string, GlAccountType>();

  for (const account of input.accounts) {
    const accountType = mapAccountType(account.AccountType);
    if (!accountType) {
      rejected.push({
        entity: "glAccounts",
        externalId: account.Id,
        reason: `Unrecognized QuickBooks account type "${account.AccountType}".`,
      });
      continue;
    }
    typeById.set(account.Id, accountType);
    glAccounts.push({
      externalId: account.Id,
      // The schema requires a code and QuickBooks does not require an account
      // number, so the id stands in — stable, and unique within the company.
      code: account.AcctNum ?? account.Id,
      name: account.Name,
      accountType,
      // QuickBooks does not flag trust accounts and a name heuristic would be
      // guessing about client money. Safe by construction: profitAndLoss sums
      // only income and expense types, and a deposit account maps to liability.
      isTrustAccount: false,
    });
  }

  const glTransactions: ImportGlTransaction[] = [];

  for (const entry of input.journalEntries) {
    if (!entry.TxnDate) {
      rejected.push({ entity: "glTransactions", externalId: entry.Id, reason: "Journal entry has no transaction date." });
      continue;
    }
    for (const [index, line] of (entry.Line ?? []).entries()) {
      // Line ids are stable within an entry; the index is a fallback so a line
      // without one still gets a deterministic id rather than a random one.
      const externalId = `${entry.Id}:${line.Id ?? index}`;
      const accountId = line.JournalEntryLineDetail?.AccountRef?.value;
      const accountType = accountId ? typeById.get(accountId) : undefined;
      if (!accountId || !accountType) {
        rejected.push({ entity: "glTransactions", externalId, reason: "Line posts to an account this batch does not contain." });
        continue;
      }
      const amountCents = signedAmountCents(
        accountType,
        line.JournalEntryLineDetail?.PostingType ?? "",
        line.Amount ?? Number.NaN,
      );
      if (amountCents === null) {
        rejected.push({ entity: "glTransactions", externalId, reason: "Line amount or posting type could not be trusted." });
        continue;
      }
      glTransactions.push({
        externalId,
        accountExternalId: accountId,
        // QuickBooks has no concept of Aval's properties, so nothing to bind.
        propertyExternalId: null,
        amountCents,
        postedAt: entry.TxnDate,
      });
    }
  }

  return { batch: { glAccounts, glTransactions }, rejected };
}
