/**
 * P&L rollup, NOI and cross-system reconciliation for the Accounting tab.
 *
 * NOI accuracy is the figure 2026 operators are most exposed on — margins are
 * tighter and cost variability (utilities, repair labor, insurance) is higher
 * — so the rollup here is explicit about what it included, what it excluded,
 * and what it could not see, rather than producing one confident number.
 *
 * Pure functions over row shapes — see the note at the top of `occupancy.ts`.
 */

import {
  NOI_EXPENSE_TYPES,
  NOI_INCOME_TYPES,
  percentOf,
  round,
  type GlAccountType,
} from "../types.ts";
import { netOperatingIncome, operatingExpenseRatioPct } from "../../finance/metrics.ts";

export interface GlAccountLike {
  id: string;
  code: string;
  name: string;
  accountType: GlAccountType;
  isTrustAccount: boolean;
}

export interface GlTransactionLike {
  id: string;
  accountId: string;
  propertyId: string | null;
  amountCents: number;
  postedAt: Date;
}

export interface ProfitAndLoss {
  incomeCents: number;
  operatingExpenseCents: number;
  noiCents: number;
  /** Operating expenses over income, as a percent. Null when there was no income to measure against. */
  operatingExpenseRatioPct: number | null;
  noiMarginPct: number | null;
  /** Reported beside NOI, never inside it — a roof replacement is not an operating result. */
  capitalExpenseCents: number;
  /** Trust-account movement, excluded from every figure above. Deposits are the resident's money. */
  excludedTrustCents: number;
  /** Transactions whose account is not in the chart supplied — excluded and counted, never silently dropped. */
  unmappedTransactionCount: number;
}

/**
 * A period's P&L from GL rows.
 *
 * Three exclusions are structural rather than remembered, which is the point
 * of computing this from account *types* instead of account name matching:
 * capital expense never enters NOI, trust accounts never enter anything, and a
 * transaction pointing at an account outside the supplied chart is counted as
 * unmapped rather than guessed at. An unmapped count above zero means the
 * number on screen is incomplete, and a reader can see that.
 */
export function profitAndLoss(
  transactions: GlTransactionLike[],
  accounts: GlAccountLike[],
  periodStart: Date,
  periodEnd: Date,
): ProfitAndLoss {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const inPeriod = transactions.filter((entry) => entry.postedAt >= periodStart && entry.postedAt <= periodEnd);

  let incomeCents = 0;
  let operatingExpenseCents = 0;
  let capitalExpenseCents = 0;
  let excludedTrustCents = 0;
  let unmappedTransactionCount = 0;

  for (const entry of inPeriod) {
    const account = byId.get(entry.accountId);
    if (!account) {
      unmappedTransactionCount += 1;
      continue;
    }
    if (account.isTrustAccount) {
      excludedTrustCents += entry.amountCents;
      continue;
    }
    if (NOI_INCOME_TYPES.includes(account.accountType)) incomeCents += entry.amountCents;
    else if (NOI_EXPENSE_TYPES.includes(account.accountType)) operatingExpenseCents += entry.amountCents;
    else if (account.accountType === "capital_expense") capitalExpenseCents += entry.amountCents;
    // asset / liability / equity rows are balance-sheet movement and belong in
    // neither an income statement nor NOI; they fall through deliberately.
  }

  const noiCents = netOperatingIncome(incomeCents, operatingExpenseCents);

  return {
    incomeCents,
    operatingExpenseCents,
    noiCents,
    operatingExpenseRatioPct:
      incomeCents > 0 ? round(operatingExpenseRatioPct(operatingExpenseCents, incomeCents), 2) : null,
    noiMarginPct: percentOf(noiCents, incomeCents),
    capitalExpenseCents,
    excludedTrustCents,
    unmappedTransactionCount,
  };
}

export interface PropertyProfitAndLoss extends ProfitAndLoss {
  propertyId: string | null;
  noiPerUnitCents: number | null;
}

/**
 * P&L per property, plus one row for transactions posted with no property.
 *
 * Unallocated rows get their own `propertyId: null` entry instead of being
 * spread across properties or dropped: an accounting system that posts
 * portfolio-level insurance to no property is common, and either alternative
 * would misstate every property's NOI.
 */
export function profitAndLossByProperty(
  transactions: GlTransactionLike[],
  accounts: GlAccountLike[],
  periodStart: Date,
  periodEnd: Date,
  unitCountByProperty: Map<string, number> = new Map(),
): PropertyProfitAndLoss[] {
  const groups = new Map<string | null, GlTransactionLike[]>();
  for (const entry of transactions) {
    const key = entry.propertyId;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.entries()]
    .map(([propertyId, group]) => {
      const statement = profitAndLoss(group, accounts, periodStart, periodEnd);
      const unitCount = propertyId === null ? 0 : unitCountByProperty.get(propertyId) ?? 0;
      return {
        propertyId,
        ...statement,
        noiPerUnitCents: unitCount > 0 ? Math.round(statement.noiCents / unitCount) : null,
      };
    })
    .sort((a, b) => b.noiCents - a.noiCents);
}

export interface ExpenseLineRow {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
  sharePct: number | null;
  /** Same account's total in the comparison period, when one was supplied. */
  priorAmountCents: number | null;
  variancePct: number | null;
}

/**
 * Operating expense lines, largest first, optionally against a prior period.
 *
 * The comparison is what makes this actionable: rising insurance and repair
 * labor are the 2026 cost story, and a line item is only alarming relative to
 * what it used to be. `variancePct` is null where there is no prior figure —
 * a new expense line has no variance, and showing +100% for one would flag
 * every newly-mapped account as a cost explosion.
 */
export function expenseLines(
  transactions: GlTransactionLike[],
  accounts: GlAccountLike[],
  periodStart: Date,
  periodEnd: Date,
  priorPeriod?: { start: Date; end: Date },
): ExpenseLineRow[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const operating = accounts.filter(
    (account) => NOI_EXPENSE_TYPES.includes(account.accountType) && !account.isTrustAccount,
  );

  const sumFor = (accountId: string, start: Date, end: Date) =>
    transactions
      .filter((entry) => entry.accountId === accountId && entry.postedAt >= start && entry.postedAt <= end)
      .reduce((total, entry) => total + entry.amountCents, 0);

  const rows = operating.map((account) => {
    const amountCents = sumFor(account.id, periodStart, periodEnd);
    const priorAmountCents = priorPeriod ? sumFor(account.id, priorPeriod.start, priorPeriod.end) : null;
    return {
      accountId: account.id,
      code: account.code,
      name: byId.get(account.id)?.name ?? account.name,
      amountCents,
      sharePct: null as number | null,
      priorAmountCents,
      variancePct:
        priorAmountCents !== null && priorAmountCents !== 0
          ? round(((amountCents - priorAmountCents) / priorAmountCents) * 100, 2)
          : null,
    };
  });

  const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return rows
    .map((row) => ({ ...row, sharePct: percentOf(row.amountCents, total) }))
    .filter((row) => row.amountCents !== 0 || row.priorAmountCents !== null)
    .sort((a, b) => b.amountCents - a.amountCents);
}

export interface UtilityReconciliation {
  /** Total from `utility_bills` — Aval's own infrastructure module. */
  meteredCostCents: number;
  meteredBillCount: number;
  /** Total posted to utility-flagged GL accounts over the same window. */
  ledgerCostCents: number;
  ledgerAccountCount: number;
  differenceCents: number;
  /** The difference as a share of the ledger figure, or null when the ledger has no utility line to compare against. */
  differencePct: number | null;
  /** True when both sides have data and they disagree by more than `toleranceCents`. */
  materialDifference: boolean;
}

/**
 * Cross-checks utility bills against the utilities line in the books.
 *
 * This is the whole premise of connecting a portfolio's systems made concrete:
 * the same spend recorded in two places should agree, and when it doesn't,
 * something is wrong in one of them — a missed bill, a miscoded expense, a
 * property attributed to the wrong account. Neither system can find that
 * alone.
 *
 * Reports the difference; does not resolve it. Which side is right is not
 * something this function can know, and picking one would be the silent
 * last-write-wins behavior `operations_conflicts` exists to avoid.
 */
export function reconcileUtilities(
  meteredBills: { costCents: number }[],
  utilityTransactions: GlTransactionLike[],
  utilityAccountIds: Set<string>,
  toleranceCents = 5_000,
): UtilityReconciliation {
  const meteredCostCents = meteredBills.reduce((total, bill) => total + bill.costCents, 0);
  const ledgerRows = utilityTransactions.filter((entry) => utilityAccountIds.has(entry.accountId));
  const ledgerCostCents = ledgerRows.reduce((total, entry) => total + entry.amountCents, 0);
  const differenceCents = meteredCostCents - ledgerCostCents;

  return {
    meteredCostCents,
    meteredBillCount: meteredBills.length,
    ledgerCostCents,
    ledgerAccountCount: utilityAccountIds.size,
    differenceCents,
    differencePct: percentOf(differenceCents, ledgerCostCents),
    materialDifference:
      meteredBills.length > 0 && ledgerRows.length > 0 && Math.abs(differenceCents) > toleranceCents,
  };
}

/**
 * Annualizes a period's NOI to a run rate.
 *
 * Deliberately requires the period length in days and refuses windows shorter
 * than a month: annualizing a week of collections produces a number that looks
 * authoritative and is nearly meaningless, and it is exactly the figure that
 * ends up in an owner report unqualified.
 */
export function annualizedNoiCents(noiCents: number, periodDays: number): number | null {
  if (periodDays < 28) return null;
  return Math.round((noiCents / periodDays) * 365);
}
