import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeByChannel,
  summarizeByUnitType,
  summarizeExpirations,
  summarizeFunnel,
  summarizeFunnelHealth,
  summarizeLostReasons,
  summarizeRenewals,
  type LeadLike,
} from "../lib/operations/metrics/funnel.ts";
import { MS_PER_DAY } from "../lib/operations/types.ts";

const START = new Date("2026-08-01T00:00:00Z");
const day = (offset: number) => new Date(START.getTime() + offset * MS_PER_DAY);

let sequence = 0;
function lead(overrides: Partial<LeadLike> = {}): LeadLike {
  sequence += 1;
  return {
    id: `lead-${sequence}`,
    channel: null,
    unitTypeLabel: null,
    inquiredAt: day(0),
    contactedAt: null,
    touredAt: null,
    appliedAt: null,
    approvedAt: null,
    signedAt: null,
    lostAt: null,
    lostReason: null,
    ...overrides,
  };
}

/** A lead that made it all the way through, one stage per day. */
function signedLead(overrides: Partial<LeadLike> = {}): LeadLike {
  return lead({
    contactedAt: day(1),
    touredAt: day(2),
    appliedAt: day(3),
    approvedAt: day(4),
    signedAt: day(5),
    ...overrides,
  });
}

test("the funnel counts leads that reached a stage, not leads sitting in it", () => {
  const rows = summarizeFunnel([signedLead(), lead({ contactedAt: day(1) })]);
  const toured = rows.find((row) => row.stage === "toured");
  // The signed lead passed through `toured`. Counting only current occupants
  // would report 0 here and make a converting funnel look like it converts
  // nobody.
  assert.equal(toured?.reached, 1);
  assert.equal(rows.find((row) => row.stage === "contacted")?.reached, 2);
  assert.equal(rows.find((row) => row.stage === "signed")?.reached, 1);
});

test("stage conversion is against the prior stage, and null at the top", () => {
  const rows = summarizeFunnel([signedLead(), lead({ contactedAt: day(1) }), lead()]);
  assert.equal(rows[0].stage, "inquiry");
  assert.equal(rows[0].conversionFromPriorPct, null);
  // 2 of 3 got contacted; 1 of those 2 toured.
  assert.equal(rows.find((row) => row.stage === "contacted")?.conversionFromPriorPct, 66.67);
  assert.equal(rows.find((row) => row.stage === "toured")?.conversionFromPriorPct, 50);
});

test("median days between stages measures only leads that made both", () => {
  const rows = summarizeFunnel([
    signedLead(),
    lead({ contactedAt: day(3) }), // contacted 3 days after inquiry, never toured
  ]);
  assert.equal(rows.find((row) => row.stage === "contacted")?.medianDaysFromPrior, 2); // median of [1, 3]
  assert.equal(rows.find((row) => row.stage === "toured")?.medianDaysFromPrior, 1);
});

test("funnel health names the weakest transition — where the funnel actually leaks", () => {
  const leads = [
    // Nine leads get contacted and toured; only one applies.
    ...Array.from({ length: 9 }, () => lead({ contactedAt: day(1), touredAt: day(2) })),
    signedLead(),
  ];
  const health = summarizeFunnelHealth(leads);
  assert.equal(health.totalLeads, 10);
  assert.equal(health.signedLeads, 1);
  assert.equal(health.leadToLeaseConversionPct, 10);
  assert.equal(health.medianDaysToLease, 5);
  assert.equal(health.weakestTransition?.from, "toured");
  assert.equal(health.weakestTransition?.to, "applied");
  assert.equal(health.weakestTransition?.conversionPct, 10);
});

test("a lost lead is an exit at whatever stage it reached, not a stage after signed", () => {
  const health = summarizeFunnelHealth([
    lead({ contactedAt: day(1), lostAt: day(4), lostReason: "Chose another property" }),
    signedLead(),
  ]);
  assert.equal(health.lostLeads, 1);
  assert.equal(health.signedLeads, 1);
  assert.equal(health.activeLeads, 0);

  const reasons = summarizeLostReasons([
    lead({ lostAt: day(4), lostReason: "Chose another property" }),
    lead({ lostAt: day(4), lostReason: "Chose another property" }),
    lead({ lostAt: day(4), lostReason: null }),
  ]);
  assert.equal(reasons[0].reason, "Chose another property");
  assert.equal(reasons[0].count, 2);
  assert.equal(reasons[0].sharePct, 66.67);
  // A missing reason is labelled, never dropped — a bucket of reasonless
  // losses is itself the finding.
  assert.equal(reasons[1].reason, "Not recorded");
});

test("channel-less leads group under Unattributed rather than disappearing", () => {
  const rows = summarizeByChannel([signedLead({ channel: "Zillow" }), lead({ channel: null })]);
  assert.deepEqual(rows.map((row) => row.label).sort(), ["Unattributed", "Zillow"]);
  assert.equal(rows.find((row) => row.label === "Zillow")?.conversionPct, 100);
  assert.equal(rows.find((row) => row.label === "Unattributed")?.conversionPct, 0);
});

test("days-to-lease by unit type separates what a portfolio average hides", () => {
  const rows = summarizeByUnitType([
    signedLead({ unitTypeLabel: "Studio/1BA", signedAt: day(3) }),
    signedLead({ unitTypeLabel: "3BR/2BA", signedAt: day(60) }),
  ]);
  assert.equal(rows.find((row) => row.label === "Studio/1BA")?.medianDaysToLease, 3);
  assert.equal(rows.find((row) => row.label === "3BR/2BA")?.medianDaysToLease, 60);
});

test("expiration schedule buckets active leases by month and excludes month-to-month", () => {
  const asOf = new Date("2026-09-01T00:00:00Z");
  const { schedule, monthToMonthCount } = summarizeExpirations(
    [
      { id: "l1", unitId: "u1", propertyId: "p1", status: "active", endDate: new Date("2026-11-30T00:00:00Z"), isMonthToMonth: false, rentCents: 200_000 },
      { id: "l2", unitId: "u2", propertyId: "p1", status: "active", endDate: new Date("2026-11-15T00:00:00Z"), isMonthToMonth: false, rentCents: 180_000 },
      { id: "l3", unitId: "u3", propertyId: "p1", status: "active", endDate: null, isMonthToMonth: true, rentCents: 150_000 },
      // Already expired, and an inactive lease: neither is upcoming turnover.
      { id: "l4", unitId: "u4", propertyId: "p1", status: "expired", endDate: new Date("2026-10-01T00:00:00Z"), isMonthToMonth: false, rentCents: 190_000 },
    ],
    asOf,
  );
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].month, "2026-11");
  assert.equal(schedule[0].leaseCount, 2);
  assert.equal(schedule[0].rentAtRiskCents, 380_000);
  assert.equal(monthToMonthCount, 1);
});

test("renewal rate counts explicit renewal links, never a fast re-lease of the same unit", () => {
  const periodStart = new Date("2026-08-01T00:00:00Z");
  const periodEnd = new Date("2026-08-31T00:00:00Z");
  const summary = summarizeRenewals(
    [
      { id: "old-1", status: "renewed", endDate: new Date("2026-08-15T00:00:00Z"), renewalOfLeaseId: null },
      { id: "old-2", status: "expired", endDate: new Date("2026-08-20T00:00:00Z"), renewalOfLeaseId: null },
      { id: "new-1", status: "active", endDate: new Date("2027-08-15T00:00:00Z"), renewalOfLeaseId: "old-1" },
      // A brand-new lease that happens to start right after old-2 ended. It
      // points at nothing, so it is turnover — which is the truth.
      { id: "new-2", status: "active", endDate: new Date("2027-09-01T00:00:00Z"), renewalOfLeaseId: null },
    ],
    periodStart,
    periodEnd,
  );
  assert.equal(summary.endedLeases, 2);
  assert.equal(summary.renewedLeases, 1);
  assert.equal(summary.renewalRatePct, 50);
  assert.equal(summary.turnoverRatePct, 50);
});

test("renewal rate is null with no leases ending in the window", () => {
  const summary = summarizeRenewals([], new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T00:00:00Z"));
  assert.equal(summary.renewalRatePct, null);
  assert.equal(summary.turnoverRatePct, null);
});
