import assert from "node:assert/strict";
import test from "node:test";
import {
  ageLeaseCharges,
  balanceCents,
  bucketFor,
  delinquentAccounts,
  entrySign,
  summarizeAging,
  summarizeCollections,
  type AgedCharge,
  type LedgerEntryLike,
} from "../lib/operations/metrics/receivables.ts";
import { profitAndLoss, type GlAccountLike, type GlTransactionLike } from "../lib/operations/metrics/financials.ts";
import { summarizeOccupancy, summarizeRentPosition, type UnitLike } from "../lib/operations/metrics/occupancy.ts";
import { summarizeFunnelHealth, type LeadLike } from "../lib/operations/metrics/funnel.ts";
import { buildVendorScorecards, summarizeSlaCompliance, type WorkOrderLike } from "../lib/operations/metrics/maintenance.ts";
import { AGING_BUCKETS, MS_PER_DAY, UNIT_STATUSES, type UnitStatus } from "../lib/operations/types.ts";

/**
 * Property-based tests: invariants that must hold for *every* input, checked
 * over thousands of randomly generated cases, plus differential comparison
 * against independently-written reference implementations.
 *
 * Where the example-based tests say "this input gives that output", these say
 * "no input can ever produce a result that violates this law". The laws chosen
 * are the ones whose violation shows up as money that does not add up — which
 * is the failure nobody catches by reading a dashboard.
 *
 * The FIFO reference below deliberately uses different mathematics from the
 * code it checks: closed-form over cumulative sums, against an iterative
 * drawdown loop. Agreement across 3,000 random ledgers is evidence precisely
 * because neither could be a transcription of the other.
 */

function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASOF = new Date("2026-09-03T00:00:00Z");
const CASES = 3000;

interface GeneratedLedger {
  entries: LedgerEntryLike[];
  chargeTotal: number;
  creditTotal: number;
}

/** A random single-lease ledger with distinct due dates, so FIFO order is total. */
function generateLedger(random: () => number): GeneratedLedger {
  const chargeCount = Math.floor(random() * 12);
  const creditCount = Math.floor(random() * 6);
  const entries: LedgerEntryLike[] = [];
  let chargeTotal = 0;
  let creditTotal = 0;

  for (let i = 0; i < chargeCount; i++) {
    const amountCents = Math.floor(random() * 400_000) + 1;
    chargeTotal += amountCents;
    entries.push({
      id: `c${i}`,
      leaseId: "lease-1",
      propertyId: "p1",
      entryType: "charge",
      category: "rent",
      amountCents,
      postedAt: new Date(ASOF.getTime() - (i + 1) * MS_PER_DAY),
      dueAt: new Date(ASOF.getTime() - (i + 1) * 7 * MS_PER_DAY),
    });
  }
  for (let i = 0; i < creditCount; i++) {
    const amountCents = Math.floor(random() * 300_000) + 1;
    creditTotal += amountCents;
    entries.push({
      id: `p${i}`,
      leaseId: "lease-1",
      propertyId: "p1",
      entryType: random() < 0.5 ? "payment" : "credit",
      category: "rent",
      amountCents,
      postedAt: new Date(ASOF.getTime() - i * MS_PER_DAY),
      dueAt: null,
    });
  }
  return { entries, chargeTotal, creditTotal };
}

/**
 * Independent FIFO reference, in closed form.
 *
 * With charges c₁…cₙ in due-date order and total credit C, the amount still
 * open on charge i is clamp(Σ₁..ᵢ c − C, 0, cᵢ). No loop, no drawdown state —
 * a different derivation of the same rule.
 */
function referenceOpenAmounts(entries: LedgerEntryLike[]): [string, number][] {
  const charges = entries
    .filter((entry) => entrySign(entry.entryType) === 1 && entry.category !== "deposit" && entry.dueAt !== null)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime());
  const credit = entries
    .filter((entry) => entrySign(entry.entryType) === -1 && entry.category !== "deposit")
    .reduce((total, entry) => total + entry.amountCents, 0);

  const open: [string, number][] = [];
  let cumulative = 0;
  for (const charge of charges) {
    cumulative += charge.amountCents;
    const remaining = Math.min(Math.max(cumulative - credit, 0), charge.amountCents);
    if (remaining > 0) open.push([charge.id, remaining]);
  }
  return open.sort((a, b) => a[0].localeCompare(b[0]));
}

/* ── receivables ─────────────────────────────────────────────────────────── */

test(`FIFO drawdown matches an independent closed-form reference across ${CASES} random ledgers`, () => {
  const random = mulberry32(20260903);
  for (let i = 0; i < CASES; i++) {
    const { entries } = generateLedger(random);
    const actual = ageLeaseCharges(entries, ASOF)
      .map((charge) => [charge.chargeId, charge.openCents] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(actual, referenceOpenAmounts(entries), `case ${i}: drawdown and closed-form disagree`);
  }
});

test(`money is conserved exactly: open = charges − applied credit, over ${CASES} ledgers`, () => {
  const random = mulberry32(11);
  for (let i = 0; i < CASES; i++) {
    const { entries, chargeTotal, creditTotal } = generateLedger(random);
    const open = ageLeaseCharges(entries, ASOF).reduce((total, charge) => total + charge.openCents, 0);

    // Credit applies until charges run out and never beyond: an overpaying
    // resident cannot drive a balance negative, and a partial payment cannot
    // vanish.
    assert.equal(open, chargeTotal - Math.min(creditTotal, chargeTotal), `case ${i}: money not conserved`);
    assert.ok(open >= 0, `case ${i}: negative open balance`);
    assert.ok(open <= chargeTotal, `case ${i}: open exceeds what was ever charged`);
  }
});

test("every open cent lands in exactly one aging bucket, and the buckets partition the total", () => {
  const random = mulberry32(777);
  for (let i = 0; i < CASES; i++) {
    const { entries } = generateLedger(random);
    const aged = ageLeaseCharges(entries, ASOF);
    const summary = summarizeAging(aged);

    const bucketSum = Object.values(summary.totals).reduce((total, value) => total + value, 0);
    assert.equal(bucketSum, summary.totalOpenCents, `case ${i}: buckets do not sum to the total`);
    assert.equal(
      summary.totalOpenCents,
      aged.reduce((total, charge) => total + charge.openCents, 0),
      `case ${i}: summary total disagrees with the charges it summarized`,
    );
    assert.equal(
      summary.totalPastDueCents + summary.totals.current,
      summary.totalOpenCents,
      `case ${i}: past due plus current does not reconstitute the total`,
    );
    for (const value of Object.values(summary.totals)) assert.ok(value >= 0, `case ${i}: negative bucket`);
  }
});

test("aging buckets are exhaustive and mutually exclusive across the whole integer range", () => {
  for (let days = -400; days <= 400; days++) {
    const matching = AGING_BUCKETS.filter((bucket) => days >= bucket.minDays && days <= bucket.maxDays);
    assert.equal(matching.length, 1, `${days} days past due matched ${matching.length} buckets`);
    assert.equal(bucketFor(days), matching[0].key);
  }
});

test("aging is monotone in time: a charge never becomes less overdue as the clock advances", () => {
  const random = mulberry32(313);
  const bucketIndex = (key: string) => AGING_BUCKETS.findIndex((bucket) => bucket.key === key);

  for (let i = 0; i < 400; i++) {
    const { entries } = generateLedger(random);
    let previous: AgedCharge[] = ageLeaseCharges(entries, ASOF);

    for (let step = 1; step <= 6; step++) {
      const later = ageLeaseCharges(entries, new Date(ASOF.getTime() + step * 30 * MS_PER_DAY));
      const byId = new Map(later.map((charge) => [charge.chargeId, charge]));

      for (const before of previous) {
        const after = byId.get(before.chargeId);
        assert.ok(after, `case ${i}: a charge stopped being open as time passed`);
        assert.ok(after.daysPastDue > before.daysPastDue, `case ${i}: days past due went backwards`);
        assert.ok(bucketIndex(after.bucket) >= bucketIndex(before.bucket), `case ${i}: bucket moved backwards`);
        // The amount owed cannot change just because time passed.
        assert.equal(after.openCents, before.openCents, `case ${i}: balance drifted with the clock`);
      }
      previous = later;
    }
  }
});

test("no floating-point contamination: every cent figure stays an exact integer", () => {
  const random = mulberry32(8675309);
  for (let i = 0; i < CASES; i++) {
    const { entries } = generateLedger(random);
    const aged = ageLeaseCharges(entries, ASOF);
    const summary = summarizeAging(aged);

    for (const charge of aged) assert.ok(Number.isInteger(charge.openCents), `case ${i}: fractional cents`);
    for (const value of Object.values(summary.totals)) assert.ok(Number.isInteger(value));
    assert.ok(Number.isInteger(summary.totalOpenCents));
    assert.ok(Number.isInteger(balanceCents(entries)));
    for (const account of delinquentAccounts(aged)) assert.ok(Number.isInteger(account.balanceCents));
  }
});

test("collection rate never invents a denominator it does not have", () => {
  const random = mulberry32(4242);
  const periodStart = new Date(ASOF.getTime() - 60 * MS_PER_DAY);
  for (let i = 0; i < CASES; i++) {
    const { entries } = generateLedger(random);
    const summary = summarizeCollections(entries, periodStart, ASOF);
    assert.ok(Number.isInteger(summary.billedCents) && summary.billedCents >= 0);
    assert.ok(Number.isInteger(summary.collectedCents) && summary.collectedCents >= 0);
    assert.equal(summary.outstandingCents, summary.billedCents - summary.collectedCents);
    if (summary.billedCents === 0) {
      // The rule that matters: no denominator means no rate, never 0% or 100%.
      assert.equal(summary.collectionRatePct, null, `case ${i}: invented a rate from nothing billed`);
    } else {
      assert.ok((summary.collectionRatePct as number) >= 0);
    }
  }
});

/* ── financials ──────────────────────────────────────────────────────────── */

const ACCOUNTS: GlAccountLike[] = [
  { id: "inc", code: "4000", name: "Rent", accountType: "income", isTrustAccount: false },
  { id: "exp", code: "6000", name: "Repairs", accountType: "operating_expense", isTrustAccount: false },
  { id: "cap", code: "7000", name: "Capital", accountType: "capital_expense", isTrustAccount: false },
  { id: "trust", code: "2100", name: "Deposits", accountType: "liability", isTrustAccount: true },
  { id: "asset", code: "1000", name: "Operating cash", accountType: "asset", isTrustAccount: false },
];
const PERIOD_START = new Date("2026-08-01T00:00:00Z");
const PERIOD_END = new Date("2026-08-31T23:59:59Z");
const IN_PERIOD = new Date("2026-08-15T00:00:00Z");

test("NOI is invariant under any amount of capital, trust or balance-sheet activity", () => {
  const random = mulberry32(2718);
  for (let i = 0; i < CASES; i++) {
    const operating: GlTransactionLike[] = Array.from({ length: Math.floor(random() * 10) + 1 }, (_, n) => ({
      id: `o${n}`,
      accountId: random() < 0.5 ? "inc" : "exp",
      propertyId: null,
      amountCents: Math.floor(random() * 500_000),
      postedAt: IN_PERIOD,
    }));
    const noise: GlTransactionLike[] = Array.from({ length: Math.floor(random() * 12) }, (_, n) => ({
      id: `n${n}`,
      accountId: (["cap", "trust", "asset"] as const)[Math.floor(random() * 3)],
      propertyId: null,
      amountCents: Math.floor(random() * 5_000_000),
      postedAt: IN_PERIOD,
    }));

    const clean = profitAndLoss(operating, ACCOUNTS, PERIOD_START, PERIOD_END);
    const noisy = profitAndLoss([...operating, ...noise], ACCOUNTS, PERIOD_START, PERIOD_END);

    // A roof replacement, a deposit and cash movement must not touch the
    // operating result. This is the structural exclusion, fuzzed.
    assert.equal(noisy.noiCents, clean.noiCents, `case ${i}: NOI moved on non-operating activity`);
    assert.equal(noisy.incomeCents, clean.incomeCents);
    assert.equal(noisy.operatingExpenseCents, clean.operatingExpenseCents);
    assert.equal(noisy.noiCents, noisy.incomeCents - noisy.operatingExpenseCents);
    assert.ok(Number.isInteger(noisy.noiCents));
  }
});

test("every in-period transaction is accounted for — classified or counted unmapped, never dropped", () => {
  const random = mulberry32(1618);
  const ids = ["inc", "exp", "cap", "trust", "asset", "ghost-1", "ghost-2"];
  const known = new Set(ACCOUNTS.map((account) => account.id));

  for (let i = 0; i < CASES; i++) {
    const transactions: GlTransactionLike[] = Array.from({ length: Math.floor(random() * 15) + 1 }, (_, n) => ({
      id: `t${n}`,
      accountId: ids[Math.floor(random() * ids.length)],
      propertyId: null,
      amountCents: Math.floor(random() * 100_000) + 1,
      postedAt: IN_PERIOD,
    }));

    const statement = profitAndLoss(transactions, ACCOUNTS, PERIOD_START, PERIOD_END);
    assert.equal(
      statement.unmappedTransactionCount,
      transactions.filter((entry) => !known.has(entry.accountId)).length,
      `case ${i}: a transaction on an unknown account was silently absorbed`,
    );
  }
});

/* ── occupancy ───────────────────────────────────────────────────────────── */

test("unit status counts always partition the portfolio exactly", () => {
  const random = mulberry32(31415);
  for (let i = 0; i < CASES; i++) {
    const units: UnitLike[] = Array.from({ length: Math.floor(random() * 30) }, (_, n) => ({
      id: `u${n}`,
      propertyId: "p1",
      status: UNIT_STATUSES[Math.floor(random() * UNIT_STATUSES.length)] as UnitStatus,
      marketRentCents: random() < 0.8 ? Math.floor(random() * 400_000) : null,
      bedrooms: Math.floor(random() * 4),
      bathrooms: 1,
      vacantSince: null,
    }));

    const summary = summarizeOccupancy(units);
    assert.equal(
      summary.occupiedUnits + summary.vacantReadyUnits + summary.vacantNotReadyUnits + summary.downUnits,
      summary.totalUnits,
      `case ${i}: statuses do not partition the portfolio`,
    );
    assert.equal(summary.rentableUnits, summary.totalUnits - summary.downUnits);
    assert.ok(summary.noticeUnits <= summary.occupiedUnits);

    if (summary.rentableUnits === 0) {
      assert.equal(summary.physicalOccupancyPct, null, `case ${i}: invented an occupancy rate from no units`);
    } else {
      const pct = summary.physicalOccupancyPct as number;
      assert.ok(pct >= 0 && pct <= 100, `case ${i}: occupancy ${pct}% out of range`);
    }

    // Vacancy loss and gross potential rent are drawn from the same rentable
    // set, so one can never exceed the other.
    const position = summarizeRentPosition(units, []);
    assert.ok(position.vacancyLossCents <= position.grossPotentialRentCents, `case ${i}: vacancy loss exceeds GPR`);
  }
});

/* ── funnel ──────────────────────────────────────────────────────────────── */

test("every lead is in exactly one terminal state: signed, lost, or still active", () => {
  const random = mulberry32(161803);
  for (let i = 0; i < CASES; i++) {
    const leads: LeadLike[] = Array.from({ length: Math.floor(random() * 25) }, (_, n) => {
      const roll = random();
      const inquiredAt = new Date(ASOF.getTime() - Math.floor(random() * 90) * MS_PER_DAY);
      return {
        id: `l${n}`,
        channel: null,
        unitTypeLabel: null,
        inquiredAt,
        contactedAt: random() < 0.8 ? inquiredAt : null,
        touredAt: random() < 0.5 ? inquiredAt : null,
        appliedAt: random() < 0.3 ? inquiredAt : null,
        approvedAt: null,
        signedAt: roll < 0.15 ? new Date(inquiredAt.getTime() + MS_PER_DAY) : null,
        lostAt: roll >= 0.15 && roll < 0.5 ? new Date(inquiredAt.getTime() + MS_PER_DAY) : null,
        lostReason: null,
      };
    });

    const health = summarizeFunnelHealth(leads);
    assert.equal(
      health.signedLeads + health.lostLeads + health.activeLeads,
      health.totalLeads,
      `case ${i}: leads do not partition into signed / lost / active`,
    );
    assert.ok(health.activeLeads >= 0, `case ${i}: negative active leads — a lead counted twice`);
    if (health.totalLeads === 0) assert.equal(health.leadToLeaseConversionPct, null);
  }
});

/* ── maintenance ─────────────────────────────────────────────────────────── */

test("SLA and vendor figures stay inside the bounds their own definitions allow", () => {
  const random = mulberry32(27182);
  const priorities = ["emergency", "urgent", "routine", "preventive"] as const;

  for (let i = 0; i < 1500; i++) {
    const orders: WorkOrderLike[] = Array.from({ length: Math.floor(random() * 40) }, (_, n) => {
      const reportedAt = new Date(ASOF.getTime() - Math.floor(random() * 120) * MS_PER_DAY);
      const done = random() < 0.7;
      return {
        id: `w${n}`,
        propertyId: "p1",
        unitId: `u${n % 5}`,
        vendorId: random() < 0.9 ? `v${n % 3}` : null,
        category: "plumbing",
        priority: priorities[Math.floor(random() * priorities.length)],
        status: done ? "completed" : "reported",
        reportedAt,
        assignedAt: reportedAt,
        completedAt: done ? new Date(reportedAt.getTime() + Math.floor(random() * 200) * 3_600_000) : null,
        estimateCents: random() < 0.6 ? Math.floor(random() * 100_000) + 1 : null,
        actualCostCents: random() < 0.6 ? Math.floor(random() * 100_000) : null,
        callbackOfWorkOrderId: null,
      };
    });

    for (const row of summarizeSlaCompliance(orders, ASOF)) {
      assert.ok(row.withinTargetCount <= row.completedCount, `case ${i}: more on-time than completed`);
      if (row.completedCount === 0) assert.equal(row.compliancePct, null, `case ${i}: compliance from no completions`);
      else assert.ok((row.compliancePct as number) >= 0 && (row.compliancePct as number) <= 100);
    }

    for (const scorecard of buildVendorScorecards(orders)) {
      assert.ok(scorecard.completedCount <= scorecard.assignedCount);
      assert.ok(scorecard.callbackCount <= scorecard.completedCount);
      if (scorecard.completedCount === 0) assert.equal(scorecard.firstTimeFixPct, null);
      else {
        const pct = scorecard.firstTimeFixPct as number;
        assert.ok(pct >= 0 && pct <= 100, `case ${i}: first-time-fix ${pct}% out of range`);
      }
      // Cost variance is reported only where the sample supports it.
      if (scorecard.jobsWithBothCostFigures === 0) assert.equal(scorecard.costVsEstimatePct, null);
    }
  }
});
