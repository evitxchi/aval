import assert from "node:assert/strict";
import test from "node:test";
import {
  ageLeaseCharges,
  balanceCents,
  bucketFor,
  delinquentAccounts,
  depositsHeldCents,
  entrySign,
  summarizeAging,
  summarizeCollections,
  type LedgerEntryLike,
} from "../lib/operations/metrics/receivables.ts";
import { MS_PER_DAY, type LedgerCategory, type LedgerEntryType } from "../lib/operations/types.ts";

const ASOF = new Date("2026-09-03T00:00:00Z");
const daysAgo = (days: number) => new Date(ASOF.getTime() - days * MS_PER_DAY);

let sequence = 0;
function entry(
  entryType: LedgerEntryType,
  amountCents: number,
  options: { category?: LedgerCategory; dueDaysAgo?: number; postedDaysAgo?: number; leaseId?: string } = {},
): LedgerEntryLike {
  sequence += 1;
  return {
    id: `e${sequence}`,
    leaseId: options.leaseId ?? "lease-1",
    propertyId: "p1",
    entryType,
    category: options.category ?? "rent",
    amountCents,
    postedAt: daysAgo(options.postedDaysAgo ?? options.dueDaysAgo ?? 0),
    dueAt: options.dueDaysAgo === undefined ? null : daysAgo(options.dueDaysAgo),
  };
}

test("entrySign classifies every entry type, and refuses an unclassified one", () => {
  assert.equal(entrySign("charge"), 1);
  assert.equal(entrySign("refund"), 1);
  assert.equal(entrySign("payment"), -1);
  assert.equal(entrySign("credit"), -1);
  assert.throws(() => entrySign("transfer" as LedgerEntryType), /unclassified/);
});

test("balance excludes deposits by default — trust money is not a receivable", () => {
  const entries = [
    entry("charge", 200_000),
    entry("payment", 150_000),
    entry("charge", 100_000, { category: "deposit" }),
  ];
  assert.equal(balanceCents(entries), 50_000);
  assert.equal(balanceCents(entries, { includeDeposits: true }), 150_000);
});

test("credits apply oldest-charge-first, so a partial payment clears the oldest arrears", () => {
  const aged = ageLeaseCharges(
    [
      entry("charge", 200_000, { dueDaysAgo: 95 }),
      entry("charge", 200_000, { dueDaysAgo: 65 }),
      entry("charge", 200_000, { dueDaysAgo: 35 }),
      entry("payment", 250_000),
    ],
    ASOF,
  );

  // 250,000 settles the 95-day charge entirely and half the 65-day one.
  assert.equal(aged.length, 2);
  assert.equal(aged[0].daysPastDue, 65);
  assert.equal(aged[0].openCents, 150_000);
  assert.equal(aged[1].daysPastDue, 35);
  assert.equal(aged[1].openCents, 200_000);
  // Applying newest-first instead would have left the 95-day charge open and
  // reported this account as 90+ days delinquent.
  assert.ok(!aged.some((charge) => charge.bucket === "d90_plus"));
});

test("a charge with no due date is not aged — it cannot be past a deadline nobody set", () => {
  const aged = ageLeaseCharges([entry("charge", 100_000)], ASOF);
  assert.deepEqual(aged, []);
});

test("aging buckets follow the 30/60/90 ladder every owner already reads", () => {
  assert.equal(bucketFor(0), "current");
  assert.equal(bucketFor(-5), "current");
  assert.equal(bucketFor(1), "d1_30");
  assert.equal(bucketFor(30), "d1_30");
  assert.equal(bucketFor(31), "d31_60");
  assert.equal(bucketFor(90), "d61_90");
  assert.equal(bucketFor(91), "d90_plus");
});

test("aging summary separates past due from merely open", () => {
  const aged = ageLeaseCharges(
    [entry("charge", 100_000, { dueDaysAgo: -5 }), entry("charge", 300_000, { dueDaysAgo: 45 })],
    ASOF,
  );
  const summary = summarizeAging(aged);
  assert.equal(summary.totalOpenCents, 400_000);
  assert.equal(summary.totalPastDueCents, 300_000);
  assert.equal(summary.totals.current, 100_000);
  assert.equal(summary.totals.d31_60, 300_000);
  assert.equal(summary.delinquentLeaseCount, 1);
});

test("delinquent accounts are ordered by age, not by amount", () => {
  const aged = [
    ...ageLeaseCharges([entry("charge", 900_000, { dueDaysAgo: 10, leaseId: "big-recent" })], ASOF),
    ...ageLeaseCharges([entry("charge", 50_000, { dueDaysAgo: 120, leaseId: "small-old" })], ASOF),
  ];
  const accounts = delinquentAccounts(aged);
  assert.equal(accounts[0].leaseId, "small-old");
  assert.equal(accounts[0].worstBucket, "d90_plus");
  assert.equal(accounts[1].leaseId, "big-recent");
});

test("collection rate is scoped to the period, so arrears catch-up can't push a bad month over 100%", () => {
  const periodStart = daysAgo(30);
  const summary = summarizeCollections(
    [
      entry("charge", 200_000, { postedDaysAgo: 20 }),
      entry("payment", 150_000, { postedDaysAgo: 15 }),
      // A large payment against a charge from four months ago, posted outside
      // the window: excluded on both sides.
      entry("payment", 800_000, { postedDaysAgo: 120 }),
    ],
    periodStart,
    ASOF,
  );
  assert.equal(summary.billedCents, 200_000);
  assert.equal(summary.collectedCents, 150_000);
  assert.equal(summary.collectionRatePct, 75);
  assert.equal(summary.outstandingCents, 50_000);
});

test("collection rate is null when nothing was billed", () => {
  assert.equal(summarizeCollections([], daysAgo(30), ASOF).collectionRatePct, null);
});

test("deposits held counts money in less money out, not the charge that billed it", () => {
  const entries = [
    entry("charge", 200_000, { category: "deposit" }),
    entry("payment", 200_000, { category: "deposit" }),
  ];
  // Netting charge against payment via entrySign would report 0 held for a
  // deposit that has actually been collected in full.
  assert.equal(depositsHeldCents(entries), 200_000);
  assert.equal(depositsHeldCents([...entries, entry("refund", 50_000, { category: "deposit" })]), 150_000);
});
