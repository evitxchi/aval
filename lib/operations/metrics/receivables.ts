/**
 * Receivables: balances, AR aging and collection rate for the Accounting tab.
 *
 * The delinquency report is the one an owner reads most closely and the one a
 * property manager gets asked about first, so the arithmetic here is written
 * to be checkable line by line rather than compact.
 *
 * Pure functions over row shapes — see the note at the top of `occupancy.ts`
 * for why the database access lives elsewhere.
 */

import {
  AGING_BUCKETS,
  CREDIT_ENTRY_TYPES,
  DEBIT_ENTRY_TYPES,
  daysBetween,
  percentOf,
  type AgingBucketKey,
  type LedgerCategory,
  type LedgerEntryType,
} from "../types.ts";

export interface LedgerEntryLike {
  id: string;
  leaseId: string;
  propertyId: string;
  entryType: LedgerEntryType;
  category: LedgerCategory;
  amountCents: number;
  postedAt: Date;
  dueAt: Date | null;
}

/** `+1` when an entry increases what is owed, `-1` when it reduces it. */
export function entrySign(entryType: LedgerEntryType): 1 | -1 {
  if (DEBIT_ENTRY_TYPES.includes(entryType)) return 1;
  if (CREDIT_ENTRY_TYPES.includes(entryType)) return -1;
  // Unreachable while LedgerEntryType stays a closed union covered by the two
  // arrays above; the type system enforces that at every call site. Throwing
  // rather than defaulting to +1 means a future entry type added to only one
  // of those lists fails loudly instead of silently inflating every balance.
  throw new Error(`entrySign: unclassified ledger entry type "${entryType}"`);
}

/**
 * Net balance across entries. Positive means money is owed to the portfolio.
 *
 * Deposits are excluded by default: they are the resident's money held in
 * trust, not a receivable, and most states require them held separately
 * besides. Rolling them into a balance both overstates what is owed and
 * mixes trust funds into an operating figure.
 */
export function balanceCents(entries: LedgerEntryLike[], options: { includeDeposits?: boolean } = {}): number {
  const relevant = options.includeDeposits ? entries : entries.filter((entry) => entry.category !== "deposit");
  return relevant.reduce((total, entry) => total + entrySign(entry.entryType) * entry.amountCents, 0);
}

export interface AgedCharge {
  chargeId: string;
  leaseId: string;
  propertyId: string;
  category: LedgerCategory;
  /** What is still unpaid on this charge after credits were applied. */
  openCents: number;
  dueAt: Date;
  daysPastDue: number;
  bucket: AgingBucketKey;
}

/**
 * Ages a single lease's open charges as of `asOf`.
 *
 * Credits are applied **oldest charge first**, which is both the standard
 * convention and the conservative one: applying a payment to the newest charge
 * instead would leave the oldest balance open and push the account further
 * into the 90+ bucket than it belongs, making a portfolio look worse than it
 * is. Charges without a `dueAt` are not aged — a charge with no due date
 * cannot be past due, and dating it from `postedAt` would invent a deadline
 * the resident was never given.
 */
export function ageLeaseCharges(entries: LedgerEntryLike[], asOf: Date): AgedCharge[] {
  const charges = entries
    .filter((entry) => entrySign(entry.entryType) === 1 && entry.category !== "deposit" && entry.dueAt !== null)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())
    .map((entry) => ({ entry, remaining: entry.amountCents }));

  let credit = entries
    .filter((entry) => entrySign(entry.entryType) === -1 && entry.category !== "deposit")
    .reduce((total, entry) => total + entry.amountCents, 0);

  for (const charge of charges) {
    if (credit <= 0) break;
    const applied = Math.min(credit, charge.remaining);
    charge.remaining -= applied;
    credit -= applied;
  }

  return charges
    .filter((charge) => charge.remaining > 0)
    .map((charge) => {
      const dueAt = charge.entry.dueAt as Date;
      const daysPastDue = daysBetween(dueAt, asOf);
      return {
        chargeId: charge.entry.id,
        leaseId: charge.entry.leaseId,
        propertyId: charge.entry.propertyId,
        category: charge.entry.category,
        openCents: charge.remaining,
        dueAt,
        daysPastDue,
        bucket: bucketFor(daysPastDue),
      };
    });
}

/** The aging bucket a days-past-due figure falls in. */
export function bucketFor(daysPastDue: number): AgingBucketKey {
  for (const bucket of AGING_BUCKETS) {
    if (daysPastDue >= bucket.minDays && daysPastDue <= bucket.maxDays) return bucket.key;
  }
  // AGING_BUCKETS spans -Infinity..Infinity, so this cannot be reached; kept
  // so a future edit that leaves a gap fails here rather than mis-bucketing.
  throw new Error(`bucketFor: no aging bucket covers ${daysPastDue} days`);
}

export interface AgingSummary {
  totals: Record<AgingBucketKey, number>;
  totalOpenCents: number;
  /** Everything past due, i.e. every bucket except `current`. */
  totalPastDueCents: number;
  /** Distinct leases carrying any past-due balance. */
  delinquentLeaseCount: number;
  chargeCount: number;
}

export function summarizeAging(agedCharges: AgedCharge[]): AgingSummary {
  const totals = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, 0])) as Record<AgingBucketKey, number>;
  const delinquentLeases = new Set<string>();

  for (const charge of agedCharges) {
    totals[charge.bucket] += charge.openCents;
    if (charge.bucket !== "current") delinquentLeases.add(charge.leaseId);
  }

  const totalOpenCents = Object.values(totals).reduce((total, value) => total + value, 0);

  return {
    totals,
    totalOpenCents,
    totalPastDueCents: totalOpenCents - totals.current,
    delinquentLeaseCount: delinquentLeases.size,
    chargeCount: agedCharges.length,
  };
}

export interface CollectionSummary {
  billedCents: number;
  collectedCents: number;
  /** Collected ÷ billed, over the period. Null when nothing was billed — an empty month has no collection rate. */
  collectionRatePct: number | null;
  outstandingCents: number;
}

/**
 * Collection performance over a period.
 *
 * Billed and collected are both scoped by `postedAt` within the window, so
 * this answers "of what we charged in September, how much came in" rather than
 * mixing in payments against prior months' arrears — which would let a big
 * catch-up payment push a bad month over 100% and hide it.
 *
 * Deposits are excluded on both sides: a deposit is neither revenue billed nor
 * revenue collected.
 */
export function summarizeCollections(entries: LedgerEntryLike[], periodStart: Date, periodEnd: Date): CollectionSummary {
  const inPeriod = entries.filter(
    (entry) =>
      entry.category !== "deposit" && entry.postedAt >= periodStart && entry.postedAt <= periodEnd,
  );

  const billedCents = inPeriod
    .filter((entry) => entrySign(entry.entryType) === 1)
    .reduce((total, entry) => total + entry.amountCents, 0);
  const collectedCents = inPeriod
    .filter((entry) => entrySign(entry.entryType) === -1)
    .reduce((total, entry) => total + entry.amountCents, 0);

  return {
    billedCents,
    collectedCents,
    collectionRatePct: percentOf(collectedCents, billedCents),
    outstandingCents: billedCents - collectedCents,
  };
}

export interface DelinquentAccount {
  leaseId: string;
  propertyId: string;
  balanceCents: number;
  oldestDaysPastDue: number;
  worstBucket: AgingBucketKey;
}

/**
 * Past-due accounts, worst first.
 *
 * Ordered by age rather than amount: a small balance 120 days out is a
 * different problem from a large one billed last week, and collections work
 * is driven by how long something has been unpaid.
 */
export function delinquentAccounts(agedCharges: AgedCharge[]): DelinquentAccount[] {
  const byLease = new Map<string, AgedCharge[]>();
  for (const charge of agedCharges) {
    if (charge.bucket === "current") continue;
    const group = byLease.get(charge.leaseId);
    if (group) group.push(charge);
    else byLease.set(charge.leaseId, [charge]);
  }

  return [...byLease.entries()]
    .map(([leaseId, charges]) => {
      const oldest = charges.reduce((worst, charge) => (charge.daysPastDue > worst.daysPastDue ? charge : worst));
      return {
        leaseId,
        propertyId: oldest.propertyId,
        balanceCents: charges.reduce((total, charge) => total + charge.openCents, 0),
        oldestDaysPastDue: oldest.daysPastDue,
        worstBucket: oldest.bucket,
      };
    })
    .sort((a, b) => b.oldestDaysPastDue - a.oldestDaysPastDue || b.balanceCents - a.balanceCents);
}

/**
 * Security deposits currently held, from the ledger rather than from the
 * lease's `depositCents`.
 *
 * The two can differ — a deposit collected in installments, or partly
 * refunded at move-out — and the ledger is what actually happened. This is a
 * trust liability an operator has to be able to state and reconcile, not
 * revenue.
 *
 * Note this deliberately does NOT use `entrySign`. That function answers "does
 * this change what the resident owes", and against a deposit the answer is the
 * opposite of what is being asked here: the `charge` that bills a deposit
 * means money is owed, not money held, and netting the charge against the
 * payment that satisfied it would report a fully-paid deposit as zero held.
 * Held money is what actually came in (`payment`) less what actually went back
 * out (`refund`).
 */
export function depositsHeldCents(entries: LedgerEntryLike[]): number {
  const deposits = entries.filter((entry) => entry.category === "deposit");
  const received = deposits
    .filter((entry) => entry.entryType === "payment")
    .reduce((total, entry) => total + entry.amountCents, 0);
  const returned = deposits
    .filter((entry) => entry.entryType === "refund")
    .reduce((total, entry) => total + entry.amountCents, 0);
  return received - returned;
}
