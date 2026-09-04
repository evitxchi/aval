import assert from "node:assert/strict";
import test from "node:test";
import {
  annualizedNoiCents,
  expenseLines,
  profitAndLoss,
  profitAndLossByProperty,
  reconcileUtilities,
  type GlAccountLike,
  type GlTransactionLike,
} from "../lib/operations/metrics/financials.ts";

const PERIOD_START = new Date("2026-08-01T00:00:00Z");
const PERIOD_END = new Date("2026-08-31T23:59:59Z");
const PRIOR = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-31T23:59:59Z") };

const ACCOUNTS: GlAccountLike[] = [
  { id: "a-rent", code: "4000", name: "Rental income", accountType: "income", isTrustAccount: false },
  { id: "a-repairs", code: "6000", name: "Repairs and maintenance", accountType: "operating_expense", isTrustAccount: false },
  { id: "a-utilities", code: "6100", name: "Utilities", accountType: "operating_expense", isTrustAccount: false },
  { id: "a-roof", code: "7000", name: "Capital improvements", accountType: "capital_expense", isTrustAccount: false },
  { id: "a-deposits", code: "2100", name: "Security deposits held", accountType: "liability", isTrustAccount: true },
];

let sequence = 0;
function txn(accountId: string, amountCents: number, options: { propertyId?: string | null; postedAt?: Date } = {}): GlTransactionLike {
  sequence += 1;
  return {
    id: `t${sequence}`,
    accountId,
    propertyId: options.propertyId ?? null,
    amountCents,
    postedAt: options.postedAt ?? new Date("2026-08-15T00:00:00Z"),
  };
}

test("NOI is income less operating expense, with capital expense reported beside it", () => {
  const statement = profitAndLoss(
    [txn("a-rent", 1_000_000), txn("a-repairs", 200_000), txn("a-utilities", 100_000), txn("a-roof", 900_000)],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
  );
  assert.equal(statement.incomeCents, 1_000_000);
  assert.equal(statement.operatingExpenseCents, 300_000);
  // A $9,000 roof does not turn a good operating month into a bad one.
  assert.equal(statement.noiCents, 700_000);
  assert.equal(statement.capitalExpenseCents, 900_000);
  assert.equal(statement.operatingExpenseRatioPct, 30);
  assert.equal(statement.noiMarginPct, 70);
});

test("trust-account movement is excluded from every P&L figure and reported on its own", () => {
  const statement = profitAndLoss(
    [txn("a-rent", 1_000_000), txn("a-deposits", 250_000)],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
  );
  assert.equal(statement.incomeCents, 1_000_000);
  assert.equal(statement.noiCents, 1_000_000);
  assert.equal(statement.excludedTrustCents, 250_000);
});

test("a transaction on an unknown account is counted as unmapped, never guessed at", () => {
  const statement = profitAndLoss(
    [txn("a-rent", 1_000_000), txn("a-mystery", 400_000)],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
  );
  assert.equal(statement.incomeCents, 1_000_000);
  assert.equal(statement.unmappedTransactionCount, 1);
});

test("transactions outside the window are excluded on both sides", () => {
  const statement = profitAndLoss(
    [txn("a-rent", 1_000_000), txn("a-rent", 999_999, { postedAt: new Date("2026-07-15T00:00:00Z") })],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
  );
  assert.equal(statement.incomeCents, 1_000_000);
});

test("ratios are null, not zero, when there is no income to measure against", () => {
  const statement = profitAndLoss([txn("a-repairs", 50_000)], ACCOUNTS, PERIOD_START, PERIOD_END);
  assert.equal(statement.operatingExpenseRatioPct, null);
  assert.equal(statement.noiMarginPct, null);
  assert.equal(statement.noiCents, -50_000);
});

test("unallocated transactions get their own row rather than being spread across properties", () => {
  const rows = profitAndLossByProperty(
    [
      txn("a-rent", 600_000, { propertyId: "p1" }),
      txn("a-rent", 400_000, { propertyId: "p2" }),
      // Portfolio-level insurance posted to no property.
      txn("a-repairs", 300_000, { propertyId: null }),
    ],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
    new Map([["p1", 10]]),
  );
  const unallocated = rows.find((row) => row.propertyId === null);
  assert.equal(unallocated?.operatingExpenseCents, 300_000);
  // Neither property absorbed it, so neither property's NOI is misstated.
  assert.equal(rows.find((row) => row.propertyId === "p1")?.noiCents, 600_000);
  assert.equal(rows.find((row) => row.propertyId === "p2")?.noiCents, 400_000);
  assert.equal(rows.find((row) => row.propertyId === "p1")?.noiPerUnitCents, 60_000);
  // p2 has no unit count on file, so per-unit is null rather than a divide by zero.
  assert.equal(rows.find((row) => row.propertyId === "p2")?.noiPerUnitCents, null);
});

test("expense variance is null for a line with no prior figure, not +100%", () => {
  const lines = expenseLines(
    [
      txn("a-repairs", 300_000),
      txn("a-repairs", 200_000, { postedAt: new Date("2026-07-10T00:00:00Z") }),
      txn("a-utilities", 100_000),
    ],
    ACCOUNTS,
    PERIOD_START,
    PERIOD_END,
    PRIOR,
  );
  const repairs = lines.find((line) => line.code === "6000");
  const utilities = lines.find((line) => line.code === "6100");
  assert.equal(repairs?.variancePct, 50);
  // Utilities had no spend last month; a newly-mapped account is not a cost
  // explosion.
  assert.equal(utilities?.priorAmountCents, 0);
  assert.equal(utilities?.variancePct, null);
});

test("expense lines are ordered by size and carry their share of the total", () => {
  const lines = expenseLines([txn("a-repairs", 300_000), txn("a-utilities", 100_000)], ACCOUNTS, PERIOD_START, PERIOD_END);
  assert.equal(lines[0].code, "6000");
  assert.equal(lines[0].sharePct, 75);
  assert.equal(lines[1].sharePct, 25);
});

test("utility reconciliation reports the gap and resolves nothing", () => {
  const result = reconcileUtilities(
    [{ costCents: 120_000 }, { costCents: 80_000 }],
    [txn("a-utilities", 150_000)],
    new Set(["a-utilities"]),
  );
  assert.equal(result.meteredCostCents, 200_000);
  assert.equal(result.ledgerCostCents, 150_000);
  assert.equal(result.differenceCents, 50_000);
  assert.equal(result.materialDifference, true);
  // No field says which side won, because nothing here can know that.
  assert.equal(Object.hasOwn(result, "correctedCents"), false);
});

test("a gap inside tolerance is not called material, and one-sided data is never material", () => {
  assert.equal(
    reconcileUtilities([{ costCents: 151_000 }], [txn("a-utilities", 150_000)], new Set(["a-utilities"])).materialDifference,
    false,
  );
  // Bills recorded but nothing in the books yet is a missing connection, not a
  // discrepancy between two sources.
  assert.equal(reconcileUtilities([{ costCents: 200_000 }], [], new Set(["a-utilities"])).materialDifference, false);
});

test("NOI is not annualized from a window too short to mean anything", () => {
  assert.equal(annualizedNoiCents(100_000, 7), null);
  assert.equal(annualizedNoiCents(100_000, 30), Math.round((100_000 / 30) * 365));
});
