/**
 * The shared vocabulary of the operations model.
 *
 * Every closed set a row can hold lives here rather than as bare strings in
 * the schema, so a connector, an API route and a metric function all agree on
 * what "vacant_ready" means. The unions double as the validation list the API
 * routes check incoming values against — an unrecognized status is rejected at
 * the edge instead of landing in the database and quietly failing to match any
 * metric's filter later.
 */

/* ── entities ───────────────────────────────────────────────────────────── */

export const PROPERTY_TYPES = ["multifamily", "single_family", "commercial", "mixed_use"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * A unit's state, in the vocabulary operators actually use.
 *
 * `vacant_ready` and `vacant_not_ready` are separate because the distinction
 * is the whole of turnover management: a vacant unit that cannot be shown is a
 * maintenance problem, and one that can is a marketing problem. Collapsing
 * them into "vacant" makes the two indistinguishable on a dashboard.
 *
 * `notice` is occupied — the resident is still paying — but not available,
 * which is why physical occupancy and "available to lease" are different
 * numbers and both matter.
 */
export const UNIT_STATUSES = ["occupied", "notice", "vacant_ready", "vacant_not_ready", "down"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Statuses that mean a resident is in the unit, whatever happens next. */
export const OCCUPIED_UNIT_STATUSES: readonly UnitStatus[] = ["occupied", "notice"];

/**
 * `down` is excluded from occupancy entirely rather than counted as vacant —
 * a unit out of service for renovation is not available inventory, and
 * counting it as a vacancy understates the performance of the units actually
 * being leased. It is reported separately instead.
 */
export const RENTABLE_UNIT_STATUSES: readonly UnitStatus[] = ["occupied", "notice", "vacant_ready", "vacant_not_ready"];

export const RESIDENT_STATUSES = ["applicant", "current", "past", "guarantor"] as const;
export type ResidentStatus = (typeof RESIDENT_STATUSES)[number];

export const LEASE_STATUSES = ["pending", "active", "expired", "terminated", "renewed"] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const LEASE_RESIDENT_ROLES = ["primary", "co_resident", "guarantor"] as const;
export type LeaseResidentRole = (typeof LEASE_RESIDENT_ROLES)[number];

/* ── receivables ────────────────────────────────────────────────────────── */

export const LEDGER_ENTRY_TYPES = ["charge", "payment", "credit", "refund"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_CATEGORIES = ["rent", "deposit", "late_fee", "utility", "other"] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

/** Entry types that increase what a resident owes. */
export const DEBIT_ENTRY_TYPES: readonly LedgerEntryType[] = ["charge", "refund"];

/** Entry types that reduce it. */
export const CREDIT_ENTRY_TYPES: readonly LedgerEntryType[] = ["payment", "credit"];

/**
 * Aging buckets, in days past due.
 *
 * The 30/60/90 ladder is the industry-standard shape every owner and lender
 * already reads AR in, so it is fixed rather than configurable — a bespoke
 * bucketing would make Aval's delinquency report incomparable to the one the
 * accounting system produces, which is the opposite of the point.
 */
export const AGING_BUCKETS = [
  { key: "current", label: "Current", minDays: -Infinity, maxDays: 0 },
  { key: "d1_30", label: "1–30 days", minDays: 1, maxDays: 30 },
  { key: "d31_60", label: "31–60 days", minDays: 31, maxDays: 60 },
  { key: "d61_90", label: "61–90 days", minDays: 61, maxDays: 90 },
  { key: "d90_plus", label: "90+ days", minDays: 91, maxDays: Infinity },
] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

/* ── maintenance ────────────────────────────────────────────────────────── */

export const WORK_ORDER_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "landscaping",
  "pest",
  "turnover",
  "general",
] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];

export const WORK_ORDER_PRIORITIES = ["emergency", "urgent", "routine", "preventive"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_STATUSES = ["reported", "assigned", "in_progress", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Statuses where the work is still outstanding. */
export const OPEN_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ["reported", "assigned", "in_progress"];

/**
 * How long each priority is allowed to take, in hours, measured from
 * `reportedAt` to `completedAt`.
 *
 * These are **Aval's defaults, not a contractual SLA**, and every metric that
 * uses them reports the target alongside the result (see
 * `SlaComplianceSummary.targetHours`) so a reader can see what "82% compliant"
 * was measured against instead of taking the percentage on faith. A workspace
 * whose vendor contracts say something different is measuring against the
 * wrong bar until those targets are configurable — which is a settings surface
 * that does not exist yet, and is recorded as such rather than papered over
 * with a number presented as authoritative.
 */
export const DEFAULT_SLA_TARGET_HOURS: Record<WorkOrderPriority, number> = {
  emergency: 4,
  urgent: 24,
  routine: 72,
  preventive: 336, // 14 days — scheduled work, not a response commitment
};

/**
 * How long after a completion a new work order on the same unit is treated as
 * a possible callback when nobody linked it explicitly.
 *
 * Used only for *suggesting* links to a human, never for computing
 * first-time-fix — that metric counts only `callbackOfWorkOrderId`, which
 * someone actually asserted. Inferring callbacks from proximity would count
 * two unrelated faults in a busy unit as one vendor's failure, and a vendor
 * scorecard is not somewhere to put a guess.
 */
export const CALLBACK_SUGGESTION_WINDOW_DAYS = 30;

/**
 * How long a unit may sit vacant before it is worth surfacing.
 *
 * Defined here rather than alongside the other insight thresholds because two
 * things read it — `summarizeVacancyDuration`, which decides which units are
 * over it, and the insight rule, which reports that they are. When they were
 * separate constants they disagreed (30 against 45), so the API advertised a
 * threshold the rule did not use. One value, read by both.
 */
export const VACANCY_THRESHOLD_DAYS = 30;

/* ── leasing ────────────────────────────────────────────────────────────── */

/**
 * The lead-to-lease funnel, in order. Position in this array *is* the stage
 * order — conversion between consecutive stages is computed from it, so
 * inserting a stage here is all it takes to add it to every funnel metric.
 *
 * `lost` is deliberately not in this list: it is an exit from the funnel at
 * whatever stage the lead reached, not a sixth step after `signed`. Treating
 * it as a stage would make every lost lead look like it progressed further
 * than it did.
 */
export const LEAD_STAGES = ["inquiry", "contacted", "toured", "applied", "approved", "signed"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number] | "lost";

export const ALL_LEAD_STAGES = [...LEAD_STAGES, "lost"] as const;

/** The timestamp column that records reaching each stage. */
export const LEAD_STAGE_TIMESTAMP: Record<(typeof LEAD_STAGES)[number], string> = {
  inquiry: "inquiredAt",
  contacted: "contactedAt",
  toured: "touredAt",
  applied: "appliedAt",
  approved: "approvedAt",
  signed: "signedAt",
};

/* ── accounting ─────────────────────────────────────────────────────────── */

export const GL_ACCOUNT_TYPES = [
  "income",
  "operating_expense",
  "capital_expense",
  "asset",
  "liability",
  "equity",
] as const;
export type GlAccountType = (typeof GL_ACCOUNT_TYPES)[number];

/**
 * The two account types NOI is built from.
 *
 * `capital_expense` is excluded by definition — NOI is a measure of operating
 * performance, and folding a roof replacement into it would make a good year
 * with one big capital project look like a bad operating year. The exclusion
 * lives here as a named constant so the reason is stated once and every
 * caller inherits it.
 */
export const NOI_INCOME_TYPES: readonly GlAccountType[] = ["income"];
export const NOI_EXPENSE_TYPES: readonly GlAccountType[] = ["operating_expense"];

/* ── provenance ─────────────────────────────────────────────────────────── */

/** The `sourceProvider` value for a row a person entered by hand. */
export const MANUAL_SOURCE = "manual";

export const CONFLICT_ENTITY_TYPES = [
  "property",
  "unit",
  "resident",
  "lease",
  "work_order",
  "vendor",
  "gl_account",
  "leasing_lead",
] as const;
export type ConflictEntityType = (typeof CONFLICT_ENTITY_TYPES)[number];

export const CONFLICT_RESOLUTIONS = ["kept_a", "kept_b", "dismissed"] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/* ── shared helpers ─────────────────────────────────────────────────────── */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Fractional hours from `from` to `to`. */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

/**
 * A percentage rounded to two decimals, matching the convention the rest of
 * this app uses (a plain `6.5` for 6.5%, never a `0.065` fraction — see
 * lib/finance/metrics.ts).
 *
 * Returns `null` rather than 0 when the denominator is zero. Zero is a real
 * measurement and "there was nothing to measure" is not; rendering the second
 * as the first is how an empty portfolio ends up displaying a confident 0%
 * collection rate.
 */
export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/** Mean of `values`, or null when there is nothing to average. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Median of `values`, or null when empty. Reported alongside means for durations, which are routinely skewed by a single stalled job. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Rounds to `places` decimals, for figures that are reported rather than composed into further arithmetic. */
export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
