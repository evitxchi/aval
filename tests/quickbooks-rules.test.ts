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

import { normalizeQuickbooks } from "../lib/integrations/quickbooks-rules.ts";

const ACCOUNT = { Id: "7", Name: "Rental Income", AcctNum: "4000", AccountType: "Income", Active: true };

const ENTRY = {
  Id: "154",
  TxnDate: "2026-08-15",
  Line: [
    { Id: "0", Amount: 2400, DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "7" } } },
    { Id: "1", Amount: 2400, DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "9" } } },
  ],
};

const BANK = { Id: "9", Name: "Operating Checking", AcctNum: "1000", AccountType: "Bank" };

test("an account becomes an import row keyed on its QuickBooks id", () => {
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT], journalEntries: [] });
  assert.deepEqual(batch.glAccounts, [
    { externalId: "7", code: "4000", name: "Rental Income", accountType: "income", isTrustAccount: false },
  ]);
});

test("an account with no number falls back to its id, which the schema requires", () => {
  const { batch } = normalizeQuickbooks({ accounts: [{ ...ACCOUNT, AcctNum: undefined }], journalEntries: [] });
  assert.equal(batch.glAccounts?.[0].code, "7");
});

test("an inactive account is still imported, because its history still counts", () => {
  const { batch } = normalizeQuickbooks({ accounts: [{ ...ACCOUNT, Active: false }], journalEntries: [] });
  assert.equal(batch.glAccounts?.length, 1);
});

test("an account with an unmappable type is rejected with a reason", () => {
  const { batch, rejected } = normalizeQuickbooks({
    accounts: [{ ...ACCOUNT, AccountType: "Inventory Asset" }],
    journalEntries: [],
  });
  assert.equal(batch.glAccounts?.length ?? 0, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].externalId, "7");
  assert.match(rejected[0].reason, /account type/i);
});

test("one journal entry with two lines becomes two transactions with distinct ids", () => {
  // The import layer is idempotent on external id, so a re-fetched entry must
  // produce the same ids or it duplicates the portfolio's activity.
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [ENTRY] });
  assert.equal(batch.glTransactions?.length, 2);
  assert.deepEqual(batch.glTransactions?.map((row) => row.externalId), ["154:0", "154:1"]);
});

test("each line takes its direction from the account it posts to", () => {
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [ENTRY] });
  const [income, bank] = batch.glTransactions ?? [];
  assert.equal(income.accountExternalId, "7");
  assert.equal(income.amountCents, 240000, "a credit to income is positive revenue");
  assert.equal(bank.accountExternalId, "9");
  assert.equal(bank.amountCents, 240000, "a debit to an asset is a positive balance");
});

test("a line posting to an account not in the batch is rejected, not guessed", () => {
  const { batch, rejected } = normalizeQuickbooks({ accounts: [ACCOUNT], journalEntries: [ENTRY] });
  assert.equal(batch.glTransactions?.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].externalId, "154:1");
  assert.match(rejected[0].reason, /account/i);
});

test("a line with an unusable amount is rejected and its siblings still import", () => {
  const entry = { ...ENTRY, Line: [ENTRY.Line[0], { ...ENTRY.Line[1], Amount: 1.005 }] };
  const { batch, rejected } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [entry] });
  assert.equal(batch.glTransactions?.length, 1, "one bad line does not discard the entry");
  assert.equal(rejected.length, 1);
});

test("a journal entry with no date is rejected, since a transaction needs one", () => {
  const { batch, rejected } = normalizeQuickbooks({
    accounts: [ACCOUNT, BANK],
    journalEntries: [{ ...ENTRY, TxnDate: undefined }],
  });
  assert.equal(batch.glTransactions?.length ?? 0, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /date/i);
});

test("an empty payload produces an empty batch rather than throwing", () => {
  const { batch, rejected } = normalizeQuickbooks({ accounts: [], journalEntries: [] });
  assert.deepEqual(batch, { glAccounts: [], glTransactions: [] });
  assert.deepEqual(rejected, []);
});
