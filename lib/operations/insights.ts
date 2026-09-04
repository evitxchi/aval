/**
 * Actionable findings derived from the operations record layer.
 *
 * This is the point of collecting the data: an operator does not need another
 * dashboard, they need to be told which four things to do this week. Every
 * rule below turns rows into one of those.
 *
 * Two constraints shape all of it, and both come from how the rest of this app
 * treats claims about a customer's business:
 *
 * - **Every insight carries its evidence.** `evidence` names the rows it was
 *   built from and `figures` lists every number in the text, so a reader can
 *   go check it and Ask Aval's faithfulness gate has real tool output to
 *   verify against rather than prose. An insight that cannot say what it was
 *   computed from does not get generated.
 *
 * - **Silence beats speculation.** A rule with insufficient data emits
 *   nothing. There is no "we couldn't find any issues" reassurance, because on
 *   an empty workspace that sentence is false in the most damaging direction.
 *
 * `deriveInsights` is pure — it takes already-computed summaries — so the
 * thresholds and wording are pinned by tests without a database.
 */

import { VACANCY_THRESHOLD_DAYS, round, type WorkOrderPriority } from "./types.ts";
import type { PortfolioSummary } from "./portfolio";
import type { LeasingSummary } from "./leasing";
import type { MaintenanceReport } from "./maintenance";
import type { AccountingReport } from "./accounting";
import type { ConflictRow } from "./provenance";

export const INSIGHT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_KINDS = [
  "delinquency_severe",
  "collection_rate_low",
  "expiration_concentration",
  "funnel_bottleneck",
  "vacancy_prolonged",
  "loss_to_lease",
  "sla_breach_open",
  "vendor_first_time_fix_low",
  "vendor_cost_overrun",
  "vendor_insurance_lapsed",
  "expense_variance",
  "utility_ledger_mismatch",
  "data_conflict_open",
  "sync_incomplete",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export interface OperationsInsight {
  /** Stable within a run, so a UI can key on it; not a database id — insights are derived, never stored. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  module: "properties" | "leasing" | "maintenance" | "accounting" | "data";
  title: string;
  detail: string;
  /** What to do about it. Phrased as a step a person takes, never as an action Aval has taken. */
  suggestedAction: string;
  /** The rows this was computed from — ids a reader can open. */
  evidence: { entityType: string; entityIds: string[] };
  /** Every number appearing in `title`/`detail`, for verification. */
  figures: number[];
}

/**
 * Thresholds, in one place.
 *
 * These are Aval's defaults and are stated in the insight text wherever one
 * decides whether something fires, so a reader can tell a judgment from a
 * measurement. They are not tuned per workspace yet; that is a settings
 * surface which does not exist, and inventing per-portfolio thresholds from
 * too little history would be worse than a stated default.
 */
export const INSIGHT_THRESHOLDS = {
  /** A balance worth escalating, as a multiple of one month's rent. */
  severeDelinquencyMonths: 2,
  /** Collection rate below this is flagged. Well-run portfolios sit near-consistent; the research puts a healthy 2026 rate close to 100%. */
  collectionRatePct: 95,
  /** Share of active leases expiring in one month before it counts as a concentration. */
  expirationConcentrationPct: 20,
  /** Stage-to-stage conversion below this flags the transition as the funnel's bottleneck. */
  funnelTransitionPct: 40,
  /** Days a unit can sit vacant before it is a finding. The same constant `summarizeVacancyDuration` filters on, so this is what actually fired. */
  vacancyDays: VACANCY_THRESHOLD_DAYS,
  /** Loss to lease worth surfacing, as a share of in-place rent. */
  lossToLeasePct: 5,
  /** First-time-fix rate below this flags a vendor. The maintenance research targets 80% or better. */
  vendorFirstTimeFixPct: 80,
  /** Billing this far over a vendor's own estimate, as a percent. */
  vendorCostOverrunPct: 15,
  /** Expense line growth over the prior period, as a percent. */
  expenseVariancePct: 20,
  /** Minimum sample sizes, so a single job or lead never produces a confident-sounding rate. */
  minVendorJobs: 3,
  minLeadsForFunnel: 10,
} as const;

function insight(
  kind: InsightKind,
  severity: InsightSeverity,
  module: OperationsInsight["module"],
  title: string,
  detail: string,
  suggestedAction: string,
  evidence: OperationsInsight["evidence"],
  figures: number[],
): OperationsInsight {
  return { id: `${kind}:${evidence.entityIds[0] ?? "portfolio"}`, kind, severity, module, title, detail, suggestedAction, evidence, figures };
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface InsightInputs {
  portfolio: PortfolioSummary | null;
  leasing: LeasingSummary | null;
  maintenance: MaintenanceReport | null;
  accounting: AccountingReport | null;
  conflicts: ConflictRow[];
}

/**
 * Every finding the current data supports, most severe first.
 *
 * Returns an empty array for a workspace with nothing connected. That is the
 * correct output, and the caller should render it as "nothing to report yet"
 * rather than as a clean bill of health.
 */
export function deriveInsights(inputs: InsightInputs): OperationsInsight[] {
  const found: OperationsInsight[] = [];
  const { portfolio, leasing, maintenance, accounting, conflicts } = inputs;

  /* ── accounting ───────────────────────────────────────────────────────── */

  if (accounting?.delinquents.length) {
    const severe = accounting.delinquents.filter(
      (account) => account.monthsOfRentOwed !== null && account.monthsOfRentOwed >= INSIGHT_THRESHOLDS.severeDelinquencyMonths,
    );
    if (severe.length > 0) {
      const totalCents = severe.reduce((total, account) => total + account.balanceCents, 0);
      const oldest = Math.max(...severe.map((account) => account.oldestDaysPastDue));
      found.push(
        insight(
          "delinquency_severe",
          "critical",
          "accounting",
          `${severe.length} account${severe.length === 1 ? "" : "s"} owe two months' rent or more`,
          `${severe.length} lease${severe.length === 1 ? "" : "s"} carry a past-due balance of at least ${INSIGHT_THRESHOLDS.severeDelinquencyMonths} months' rent, totalling ${formatCents(totalCents)}. The oldest unpaid charge is ${oldest} days past due.`,
          "Review these accounts for a payment plan or the start of a formal process, before the balance passes what a deposit covers.",
          { entityType: "lease", entityIds: severe.map((account) => account.leaseId) },
          [severe.length, totalCents, oldest, INSIGHT_THRESHOLDS.severeDelinquencyMonths],
        ),
      );
    }
  }

  if (accounting?.collections && accounting.collections.collectionRatePct !== null) {
    const rate = accounting.collections.collectionRatePct;
    if (rate < INSIGHT_THRESHOLDS.collectionRatePct) {
      found.push(
        insight(
          "collection_rate_low",
          rate < 85 ? "critical" : "high",
          "accounting",
          `Collection rate is ${rate}% for this period`,
          `${formatCents(accounting.collections.collectedCents)} collected against ${formatCents(accounting.collections.billedCents)} billed, leaving ${formatCents(accounting.collections.outstandingCents)} outstanding. Aval flags anything under ${INSIGHT_THRESHOLDS.collectionRatePct}%.`,
          "Check whether this is a handful of large balances or broad slippage — the aging breakdown separates the two.",
          { entityType: "portfolio", entityIds: [] },
          [rate, accounting.collections.collectedCents, accounting.collections.billedCents, accounting.collections.outstandingCents, INSIGHT_THRESHOLDS.collectionRatePct],
        ),
      );
    }
  }

  for (const line of accounting?.expenseLines ?? []) {
    if (line.variancePct === null || line.variancePct < INSIGHT_THRESHOLDS.expenseVariancePct) continue;
    found.push(
      insight(
        "expense_variance",
        line.variancePct >= 50 ? "high" : "medium",
        "accounting",
        `${line.name} is up ${line.variancePct}% over the prior period`,
        `${formatCents(line.amountCents)} this period against ${formatCents(line.priorAmountCents as number)} last, on account ${line.code}.`,
        "Confirm the increase is real rather than a timing difference or a re-coded expense before it lands in an owner report.",
        { entityType: "gl_account", entityIds: [line.accountId] },
        [line.variancePct, line.amountCents, line.priorAmountCents as number],
      ),
    );
  }

  if (accounting?.utilityReconciliation?.materialDifference) {
    const reconciliation = accounting.utilityReconciliation;
    found.push(
      insight(
        "utility_ledger_mismatch",
        "medium",
        "accounting",
        "Metered utility spend and the books disagree",
        `Utility bills recorded in Aval total ${formatCents(reconciliation.meteredCostCents)} across ${reconciliation.meteredBillCount} bill(s), while the utilities line in the general ledger shows ${formatCents(reconciliation.ledgerCostCents)} — a difference of ${formatCents(Math.abs(reconciliation.differenceCents))}. Neither figure has been adjusted.`,
        "Find which side is incomplete: a bill not yet entered, or a utility expense posted to a different account.",
        { entityType: "portfolio", entityIds: [] },
        [reconciliation.meteredCostCents, reconciliation.meteredBillCount, reconciliation.ledgerCostCents, Math.abs(reconciliation.differenceCents)],
      ),
    );
  }

  /* ── leasing ──────────────────────────────────────────────────────────── */

  if (leasing?.expirations.schedule.length && leasing.activeLeaseCount > 0) {
    for (const month of leasing.expirations.schedule) {
      const sharePct = round((month.leaseCount / leasing.activeLeaseCount) * 100, 1);
      if (sharePct < INSIGHT_THRESHOLDS.expirationConcentrationPct) continue;
      found.push(
        insight(
          "expiration_concentration",
          sharePct >= 35 ? "high" : "medium",
          "leasing",
          `${sharePct}% of active leases expire in ${month.month}`,
          `${month.leaseCount} of ${leasing.activeLeaseCount} active leases end that month, covering ${formatCents(month.rentAtRiskCents)} of monthly rent. Aval flags any month above ${INSIGHT_THRESHOLDS.expirationConcentrationPct}%.`,
          "Start renewal conversations early and consider staggering some terms, so one month's turnover doesn't become one month's vacancy.",
          { entityType: "month", entityIds: [month.month] },
          [sharePct, month.leaseCount, leasing.activeLeaseCount, month.rentAtRiskCents, INSIGHT_THRESHOLDS.expirationConcentrationPct],
        ),
      );
    }
  }

  if (
    leasing?.health?.weakestTransition &&
    leasing.health.totalLeads >= INSIGHT_THRESHOLDS.minLeadsForFunnel &&
    leasing.health.weakestTransition.conversionPct < INSIGHT_THRESHOLDS.funnelTransitionPct
  ) {
    const transition = leasing.health.weakestTransition;
    found.push(
      insight(
        "funnel_bottleneck",
        "high",
        "leasing",
        `Only ${transition.conversionPct}% of leads get from ${transition.from} to ${transition.to}`,
        `Across ${leasing.health.totalLeads} leads in this period, ${transition.from} → ${transition.to} is the weakest step in the funnel. Overall lead-to-lease conversion is ${leasing.health.leadToLeaseConversionPct ?? 0}%.`,
        `Work this one step rather than the whole funnel — the drop is concentrated between ${transition.from} and ${transition.to}.`,
        { entityType: "funnel_stage", entityIds: [transition.from, transition.to] },
        [transition.conversionPct, leasing.health.totalLeads, leasing.health.leadToLeaseConversionPct ?? 0],
      ),
    );
  }

  /* ── properties ───────────────────────────────────────────────────────── */

  if (portfolio?.vacancy.overThresholdUnitIds.length) {
    const ids = portfolio.vacancy.overThresholdUnitIds;
    found.push(
      insight(
        "vacancy_prolonged",
        ids.length >= 5 ? "high" : "medium",
        "properties",
        `${ids.length} unit${ids.length === 1 ? " has" : "s have"} been vacant over ${VACANCY_THRESHOLD_DAYS} days`,
        `The longest has been vacant ${portfolio.vacancy.longestDaysVacant ?? 0} days, against a portfolio average of ${portfolio.vacancy.averageDaysVacant ?? 0} days across ${portfolio.vacancy.measuredUnits} measured vacant unit(s).`,
        "Check whether these are priced above the market or held up by make-ready work — the two need opposite responses.",
        { entityType: "unit", entityIds: ids },
        [ids.length, portfolio.vacancy.longestDaysVacant ?? 0, portfolio.vacancy.averageDaysVacant ?? 0, portfolio.vacancy.measuredUnits],
      ),
    );
  }

  if (portfolio?.rentPosition.lossToLeaseCents !== null && portfolio?.rentPosition.lossToLeaseCents !== undefined) {
    const { lossToLeaseCents, inPlaceRentCents, lossToLeaseUnitCount } = portfolio.rentPosition;
    const sharePct = inPlaceRentCents > 0 ? round((lossToLeaseCents / inPlaceRentCents) * 100, 1) : 0;
    if (sharePct >= INSIGHT_THRESHOLDS.lossToLeasePct) {
      found.push(
        insight(
          "loss_to_lease",
          "medium",
          "properties",
          `In-place rents sit ${sharePct}% below asking`,
          `Across ${lossToLeaseUnitCount} occupied unit(s) with both figures on file, market rent exceeds contract rent by ${formatCents(lossToLeaseCents)} a month against ${formatCents(inPlaceRentCents)} of in-place rent.`,
          "Bring the gap into renewal pricing — this is recoverable at turnover without a single new lead.",
          { entityType: "portfolio", entityIds: [] },
          [sharePct, lossToLeaseUnitCount, lossToLeaseCents, inPlaceRentCents],
        ),
      );
    }
  }

  /* ── maintenance ──────────────────────────────────────────────────────── */

  for (const row of maintenance?.sla ?? []) {
    if (row.openBreachedCount === 0) continue;
    found.push(
      insight(
        "sla_breach_open",
        row.priority === "emergency" ? "critical" : row.priority === "urgent" ? "high" : "medium",
        "maintenance",
        `${row.openBreachedCount} open ${row.priority} work order${row.openBreachedCount === 1 ? "" : "s"} past target`,
        `These are still open beyond the ${row.targetHours}-hour target Aval measures ${row.priority} work against. That target is an Aval default, not this workspace's contracted SLA.`,
        "Reassign or escalate these before they age further; an open breach is the one maintenance number a resident also experiences.",
        { entityType: "work_order_priority", entityIds: [row.priority] },
        [row.openBreachedCount, row.targetHours],
      ),
    );
  }

  for (const vendor of maintenance?.vendors ?? []) {
    if (vendor.insuranceExpired) {
      found.push(
        insight(
          "vendor_insurance_lapsed",
          "critical",
          "maintenance",
          `${vendor.vendorName}'s certificate of insurance has lapsed`,
          `${vendor.vendorName} has ${vendor.assignedCount} work order(s) in this period and an insurance date that has already passed.`,
          "Get a current certificate before assigning further work, or route work elsewhere until one arrives.",
          { entityType: "vendor", entityIds: [vendor.vendorId] },
          [vendor.assignedCount],
        ),
      );
    }

    if (vendor.completedCount < INSIGHT_THRESHOLDS.minVendorJobs) continue;

    if (vendor.firstTimeFixPct !== null && vendor.firstTimeFixPct < INSIGHT_THRESHOLDS.vendorFirstTimeFixPct) {
      found.push(
        insight(
          "vendor_first_time_fix_low",
          "high",
          "maintenance",
          `${vendor.vendorName} fixes ${vendor.firstTimeFixPct}% of jobs on the first visit`,
          `${vendor.callbackCount} of ${vendor.completedCount} completed jobs had a return visit logged against them, against a ${INSIGHT_THRESHOLDS.vendorFirstTimeFixPct}% target. Only explicitly linked callbacks are counted.`,
          "Raise the callback rate at the next vendor review — repeat visits cost twice and the resident waits twice.",
          { entityType: "vendor", entityIds: [vendor.vendorId] },
          [vendor.firstTimeFixPct, vendor.callbackCount, vendor.completedCount, INSIGHT_THRESHOLDS.vendorFirstTimeFixPct],
        ),
      );
    }

    if (
      vendor.costVsEstimatePct !== null &&
      vendor.costVsEstimatePct > INSIGHT_THRESHOLDS.vendorCostOverrunPct &&
      vendor.jobsWithBothCostFigures >= INSIGHT_THRESHOLDS.minVendorJobs
    ) {
      found.push(
        insight(
          "vendor_cost_overrun",
          "medium",
          "maintenance",
          `${vendor.vendorName} bills ${vendor.costVsEstimatePct}% over its own estimates`,
          `Measured across ${vendor.jobsWithBothCostFigures} job(s) carrying both an estimate and a final cost, totalling ${formatCents(vendor.totalCostCents)}.`,
          "Ask for the variance in writing on the next few jobs, or require approval above the estimate.",
          { entityType: "vendor", entityIds: [vendor.vendorId] },
          [vendor.costVsEstimatePct, vendor.jobsWithBothCostFigures, vendor.totalCostCents],
        ),
      );
    }
  }

  /* ── data quality ─────────────────────────────────────────────────────── */

  if (conflicts.length > 0) {
    const fields = [...new Set(conflicts.map((conflict) => `${conflict.entityType}.${conflict.field}`))];
    found.push(
      insight(
        "data_conflict_open",
        "high",
        "data",
        `${conflicts.length} field${conflicts.length === 1 ? "" : "s"} where connected systems disagree`,
        `Affecting ${fields.length} field type(s): ${fields.slice(0, 5).join(", ")}. Aval kept the stored value in each case and changed nothing.`,
        "Resolve each one by choosing the system of record for that field — until then, figures built on these fields are contested.",
        { entityType: "conflict", entityIds: conflicts.map((conflict) => conflict.id) },
        [conflicts.length, fields.length],
      ),
    );
  }

  if (portfolio?.unitCountMismatches.length) {
    const mismatches = portfolio.unitCountMismatches;
    found.push(
      insight(
        "sync_incomplete",
        "medium",
        "data",
        `${mismatches.length} propert${mismatches.length === 1 ? "y reports" : "ies report"} more units than Aval has received`,
        mismatches
          .slice(0, 3)
          .map((row) => `${row.propertyName}: source says ${row.reported}, ${row.actual} received`)
          .join("; ") + ".",
        "Re-run the sync for these properties — occupancy and per-unit figures are computed over the units actually received.",
        { entityType: "property", entityIds: mismatches.map((row) => row.propertyId) },
        mismatches.flatMap((row) => [row.reported, row.actual]),
      ),
    );
  }

  return found.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Cents as a plain dollar string for insight text.
 *
 * Deliberately not `lib/finance/money.ts`'s `formatMoney`: that is locale- and
 * currency-aware for display, while these strings are also read by the model
 * and matched by the faithfulness gate, which wants one predictable form.
 */
function formatCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const formatted = dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}$${formatted}`;
}

/** Counts by severity, for a badge on the Operations nav. */
export function countBySeverity(insights: OperationsInsight[]): Record<InsightSeverity, number> {
  const counts: Record<InsightSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of insights) counts[item.severity] += 1;
  return counts;
}

/** The SLA priorities an insight run flagged, for callers that want to jump straight to the breaching queue. */
export function breachedPriorities(insights: OperationsInsight[]): WorkOrderPriority[] {
  return insights
    .filter((item) => item.kind === "sla_breach_open")
    .flatMap((item) => item.evidence.entityIds as WorkOrderPriority[]);
}
