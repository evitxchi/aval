/**
 * Lead-to-lease funnel, leasing velocity and renewal metrics for the Leasing
 * tab.
 *
 * What makes these worth having over the existing `funnel_snapshots` counts:
 * every figure here is derived from per-lead stage timestamps, so the funnel
 * can say *where* it leaks, *how long* each step takes, and *which unit types
 * and channels* are responsible. A stage count can only say how many.
 *
 * Pure functions over row shapes — see the note at the top of `occupancy.ts`.
 */

import {
  LEAD_STAGES,
  average,
  daysBetween,
  median,
  percentOf,
  round,
} from "../types.ts";

export interface LeadLike {
  id: string;
  channel: string | null;
  unitTypeLabel: string | null;
  inquiredAt: Date;
  contactedAt: Date | null;
  touredAt: Date | null;
  appliedAt: Date | null;
  approvedAt: Date | null;
  signedAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
}

type FunnelStage = (typeof LEAD_STAGES)[number];

/** The timestamp a lead carries for each stage, or null if it never reached it. */
export function stageReachedAt(lead: LeadLike, stage: FunnelStage): Date | null {
  switch (stage) {
    case "inquiry":
      return lead.inquiredAt;
    case "contacted":
      return lead.contactedAt;
    case "toured":
      return lead.touredAt;
    case "applied":
      return lead.appliedAt;
    case "approved":
      return lead.approvedAt;
    case "signed":
      return lead.signedAt;
  }
}

export interface FunnelStageRow {
  stage: FunnelStage;
  /** Leads that reached this stage at any point, whatever became of them after. */
  reached: number;
  /**
   * Share of the *previous* stage that got here. Null for `inquiry` (no prior
   * stage) and whenever the previous stage is empty.
   */
  conversionFromPriorPct: number | null;
  /** Share of all leads in the sample that got here — how the whole funnel narrows. */
  conversionFromTopPct: number | null;
  /** Median days from the previous stage, over leads that made both. Null when fewer than one such lead. */
  medianDaysFromPrior: number | null;
}

/**
 * The funnel, stage by stage.
 *
 * Counts leads that *reached* a stage rather than leads *currently sitting* in
 * it, because the two answer different questions and the second is the wrong
 * one for conversion: a lead that signed has left the tour stage, and counting
 * only current occupants would make a healthy funnel look like it converts
 * nobody.
 */
export function summarizeFunnel(leads: LeadLike[]): FunnelStageRow[] {
  const total = leads.length;

  return LEAD_STAGES.map((stage, index) => {
    const reachedLeads = leads.filter((lead) => stageReachedAt(lead, stage) !== null);
    const priorStage = index > 0 ? LEAD_STAGES[index - 1] : null;
    const priorReached = priorStage ? leads.filter((lead) => stageReachedAt(lead, priorStage) !== null).length : null;

    let medianDaysFromPrior: number | null = null;
    if (priorStage) {
      const transitions = reachedLeads
        .map((lead) => ({ from: stageReachedAt(lead, priorStage), to: stageReachedAt(lead, stage) }))
        .filter((pair): pair is { from: Date; to: Date } => pair.from !== null && pair.to !== null)
        .map((pair) => daysBetween(pair.from, pair.to));
      const value = median(transitions);
      medianDaysFromPrior = value === null ? null : round(value, 1);
    }

    return {
      stage,
      reached: reachedLeads.length,
      conversionFromPriorPct: priorReached === null ? null : percentOf(reachedLeads.length, priorReached),
      conversionFromTopPct: percentOf(reachedLeads.length, total),
      medianDaysFromPrior,
    };
  });
}

export interface FunnelHealth {
  totalLeads: number;
  signedLeads: number;
  lostLeads: number;
  /** Still moving: neither signed nor lost. */
  activeLeads: number;
  /** Signed ÷ all leads. The headline number; published benchmarks put a typical portfolio near 9% and a strong one near 16%. */
  leadToLeaseConversionPct: number | null;
  /** Median days from first inquiry to signature, over leads that signed. */
  medianDaysToLease: number | null;
  /**
   * The consecutive stage transition with the lowest conversion — where the
   * funnel actually leaks. Null until at least two stages have leads, since a
   * "worst" step is meaningless with nothing to compare.
   */
  weakestTransition: { from: FunnelStage; to: FunnelStage; conversionPct: number } | null;
}

export function summarizeFunnelHealth(leads: LeadLike[]): FunnelHealth {
  const signed = leads.filter((lead) => lead.signedAt !== null);
  const lost = leads.filter((lead) => lead.lostAt !== null && lead.signedAt === null);

  const daysToLease = signed.map((lead) => daysBetween(lead.inquiredAt, lead.signedAt as Date));
  const medianDays = median(daysToLease);

  const rows = summarizeFunnel(leads);
  const transitions = rows
    .map((row, index) => ({ row, prior: index > 0 ? LEAD_STAGES[index - 1] : null }))
    .filter((entry): entry is { row: FunnelStageRow; prior: FunnelStage } => entry.prior !== null && entry.row.conversionFromPriorPct !== null);
  const weakest = transitions.length > 0
    ? transitions.reduce((worst, entry) =>
        (entry.row.conversionFromPriorPct as number) < (worst.row.conversionFromPriorPct as number) ? entry : worst,
      )
    : null;

  return {
    totalLeads: leads.length,
    signedLeads: signed.length,
    lostLeads: lost.length,
    activeLeads: leads.length - signed.length - lost.length,
    leadToLeaseConversionPct: percentOf(signed.length, leads.length),
    medianDaysToLease: medianDays === null ? null : round(medianDays, 1),
    weakestTransition: weakest
      ? { from: weakest.prior, to: weakest.row.stage, conversionPct: weakest.row.conversionFromPriorPct as number }
      : null,
  };
}

export interface SegmentPerformance {
  label: string;
  leads: number;
  signed: number;
  conversionPct: number | null;
  medianDaysToLease: number | null;
}

function segmentBy(leads: LeadLike[], keyOf: (lead: LeadLike) => string): SegmentPerformance[] {
  const groups = new Map<string, LeadLike[]>();
  for (const lead of leads) {
    const key = keyOf(lead);
    const group = groups.get(key);
    if (group) group.push(lead);
    else groups.set(key, [lead]);
  }

  return [...groups.entries()]
    .map(([label, group]) => {
      const signed = group.filter((lead) => lead.signedAt !== null);
      const days = median(signed.map((lead) => daysBetween(lead.inquiredAt, lead.signedAt as Date)));
      return {
        label,
        leads: group.length,
        signed: signed.length,
        conversionPct: percentOf(signed.length, group.length),
        medianDaysToLease: days === null ? null : round(days, 1),
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

/**
 * Conversion and speed per acquisition channel.
 *
 * The figure that decides marketing spend: a channel delivering many leads
 * that never sign is costing money, and volume alone cannot show that.
 * Channel-less leads group under "Unattributed" rather than being dropped —
 * a large unattributed share is itself a finding about the connected sources.
 */
export function summarizeByChannel(leads: LeadLike[]): SegmentPerformance[] {
  return segmentBy(leads, (lead) => lead.channel?.trim() || "Unattributed");
}

/**
 * Conversion and days-to-lease per unit type.
 *
 * One of the leasing-velocity metrics the 2026 multifamily research singles
 * out, and invisible in a portfolio-wide average: studios leasing in a week
 * and three-beds sitting for two months average to a number that describes
 * neither.
 */
export function summarizeByUnitType(leads: LeadLike[]): SegmentPerformance[] {
  return segmentBy(leads, (lead) => lead.unitTypeLabel?.trim() || "Unspecified");
}

export interface LostReasonRow {
  reason: string;
  count: number;
  sharePct: number | null;
}

/** Why leads were lost, most common first. Free text, so grouped verbatim rather than bucketed into categories Aval would be inventing. */
export function summarizeLostReasons(leads: LeadLike[]): LostReasonRow[] {
  const lost = leads.filter((lead) => lead.lostAt !== null && lead.signedAt === null);
  const counts = new Map<string, number>();
  for (const lead of lost) {
    const reason = lead.lostReason?.trim() || "Not recorded";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, sharePct: percentOf(count, lost.length) }))
    .sort((a, b) => b.count - a.count);
}

export interface LeaseExpiryLike {
  id: string;
  unitId: string;
  propertyId: string;
  status: string;
  endDate: Date | null;
  isMonthToMonth: boolean;
  rentCents: number;
}

export interface ExpirationMonth {
  /** "2026-11" */
  month: string;
  leaseCount: number;
  rentAtRiskCents: number;
}

/**
 * Active leases ending in each of the next `months` months.
 *
 * Expiration concentration is a real operational risk — a third of a property
 * coming up in one month is a turnover surge and a rent-setting decision made
 * all at once — and it is only visible ahead of time from lease end dates.
 * Month-to-month leases are excluded: they have no end date to concentrate on,
 * and are reported separately by `monthToMonthCount`.
 */
export function summarizeExpirations(leases: LeaseExpiryLike[], asOf: Date, months = 12): { schedule: ExpirationMonth[]; monthToMonthCount: number } {
  const active = leases.filter((lease) => lease.status === "active");
  const horizon = new Date(asOf.getTime());
  horizon.setMonth(horizon.getMonth() + months);

  const buckets = new Map<string, { leaseCount: number; rentAtRiskCents: number }>();
  for (const lease of active) {
    if (lease.isMonthToMonth || lease.endDate === null) continue;
    if (lease.endDate < asOf || lease.endDate > horizon) continue;
    const month = `${lease.endDate.getUTCFullYear()}-${String(lease.endDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(month) ?? { leaseCount: 0, rentAtRiskCents: 0 };
    bucket.leaseCount += 1;
    bucket.rentAtRiskCents += lease.rentCents;
    buckets.set(month, bucket);
  }

  return {
    schedule: [...buckets.entries()]
      .map(([month, bucket]) => ({ month, ...bucket }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    monthToMonthCount: active.filter((lease) => lease.isMonthToMonth).length,
  };
}

export interface RenewalLike {
  id: string;
  status: string;
  endDate: Date | null;
  renewalOfLeaseId: string | null;
}

export interface RenewalSummary {
  /** Leases that ended in the window — the denominator. */
  endedLeases: number;
  /** Of those, how many a renewal lease points back at. */
  renewedLeases: number;
  renewalRatePct: number | null;
  turnoverRatePct: number | null;
}

/**
 * Renewal rate over a window, counted from the renewal links themselves.
 *
 * A renewal is recorded when a lease points at the one it replaced
 * (`renewalOfLeaseId`), never inferred from a new lease starting in the same
 * unit as an old one ended. That inference reads a genuine turnover with a
 * fast re-lease as a renewal, which flatters exactly the metric an owner uses
 * to judge resident satisfaction.
 */
export function summarizeRenewals(leases: RenewalLike[], periodStart: Date, periodEnd: Date): RenewalSummary {
  const ended = leases.filter(
    (lease) => lease.endDate !== null && lease.endDate >= periodStart && lease.endDate <= periodEnd,
  );
  const renewedIds = new Set(
    leases.map((lease) => lease.renewalOfLeaseId).filter((id): id is string => id !== null),
  );
  const renewed = ended.filter((lease) => renewedIds.has(lease.id)).length;
  const renewalRatePct = percentOf(renewed, ended.length);

  return {
    endedLeases: ended.length,
    renewedLeases: renewed,
    renewalRatePct,
    turnoverRatePct: renewalRatePct === null ? null : round(100 - renewalRatePct, 2),
  };
}

/** Average days-to-lease across signed leads, for callers that want a mean alongside the median `summarizeFunnelHealth` reports. */
export function averageDaysToLease(leads: LeadLike[]): number | null {
  const signed = leads.filter((lead) => lead.signedAt !== null);
  const value = average(signed.map((lead) => daysBetween(lead.inquiredAt, lead.signedAt as Date)));
  return value === null ? null : round(value, 1);
}
