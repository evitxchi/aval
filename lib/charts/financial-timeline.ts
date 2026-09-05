import {
  profitAndLoss,
  type GlAccountLike,
  type GlTransactionLike,
} from "../operations/metrics/financials.ts";
/** Closed, disjoint UTC calendar buckets within the selected window; no fabricated history. */
export function financialTimeline(
  transactions: GlTransactionLike[],
  accounts: GlAccountLike[],
  start: Date,
  end: Date,
) {
  if (
    !transactions.length ||
    !accounts.length ||
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    end < start
  )
    return null;
  const monthly = +end - +start > 45 * 86400000;
  const incomeAccounts = accounts.filter(
    (a) => a.accountType === "income" && !a.isTrustAccount,
  );
  const selected = incomeAccounts.slice(0, 5);
  const grouped = incomeAccounts.length > selected.length;
  const incomeSeries = [
    ...selected.map((a) => ({ key: a.id, label: a.name })),
    ...(grouped ? [{ key: "__other", label: null }] : []),
  ];
  const rows = [];
  let cursor = new Date(start);
  while (cursor <= end && rows.length < 370) {
    const next = monthly
      ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      : new Date(
          Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate() + 1,
          ),
        );
    const bucketEnd = new Date(Math.min(+end, +next - 1));
    const entries = transactions.filter(
      (tx) => tx.postedAt >= cursor && tx.postedAt <= bucketEnd,
    );
    const pnl = profitAndLoss(entries, accounts, cursor, bucketEnd);
    const income: Record<string, number> = Object.fromEntries(
      incomeSeries.map((s) => [s.key, 0]),
    );
    const selectedIds = new Set(selected.map((a) => a.id)),
      incomeIds = new Set(incomeAccounts.map((a) => a.id));
    for (const tx of entries)
      if (incomeIds.has(tx.accountId))
        income[selectedIds.has(tx.accountId) ? tx.accountId : "__other"] +=
          tx.amountCents;
    rows.push({
      start: cursor.toISOString(),
      end: bucketEnd.toISOString(),
      incomeCents: pnl.incomeCents,
      expenseCents: pnl.operatingExpenseCents,
      noiCents: pnl.noiCents,
      income,
    });
    cursor = next;
  }
  return { granularity: monthly ? "month" : "day", incomeSeries, rows };
}
