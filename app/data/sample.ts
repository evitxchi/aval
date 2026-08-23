export interface FunnelStage {
  key: "contacted" | "viewed" | "applied" | "signed";
  labelKey: string;
  count: number;
}

export interface CoverageRow {
  provider: string;
  labelKey: string;
  detailKey: string;
  required: boolean;
}

export interface LedgerStep {
  provider: string;
  textKey: string;
}

export interface HistoryEntry {
  id: string;
  provider: string;
  textKey: string;
  minutesAgo: number;
}

export interface EvidenceRow {
  labelKey: string;
  detailKey: string;
  amount: number;
}

export interface AttributionRow {
  driverKey: string;
  amount: number;
}

export interface InsightRecipient {
  name: string;
  detailKey: string;
  amount: number;
  channel: string;
}

export type InsightAction =
  | { type: "sendReminders"; recipients: InsightRecipient[] }
  | { type: "escalateMaintenance" }
  | { type: "draftPricingReview" }
  | { type: "openReview" };

export interface InsightCandidate {
  id: string;
  tileKey: "noi" | "economicOccupancy" | "rentCollected" | "openWorkOrders" | null;
  titleKey: string;
  detailKey: string;
  moneyAtStake: number;
  urgency: number;
  actionable: boolean;
  action: InsightAction | null;
  evidence: EvidenceRow[];
  // For every actionable insight except sendReminders (which shows a real
  // per-recipient batch preview instead): the message key for the drafted
  // review text shown before the user approves the action. Static copy for
  // now, grounded in this insight's own evidence/moneyAtStake — the seam
  // where a real model call replaces the static draft later.
  draftKey?: string;
}

export interface PropertyRow {
  nameKey: string;
  units: number;
  occupied: number;
  readyForLeasing: number;
}

export interface LeasingTrendWeek {
  labelKey: string;
  contacted: number;
  viewed: number;
  applied: number;
  signed: number;
}

export interface MaintenanceCategoryRow {
  categoryKey: string;
  // One count per entry in sampleData.maintenance.months, same order.
  countsByMonth: number[];
}

export interface AccountingFlowNode {
  key: string;
  labelKey: string;
  amount: number;
}

// Where tapping a notification actually goes — a specific drafted review, a
// specific sent-reminder receipt, a specific resident's reply thread, a
// specific upstream connection, or the full activity log. Never a bare
// "view" with nothing more precise behind it.
export type NotificationTarget =
  | { kind: "reviewDraft"; insightId: string }
  | { kind: "reminderReceipt"; insightId: string }
  | { kind: "inboxThread"; contactName: string }
  | { kind: "connectionProvider"; providerId: string }
  | { kind: "history" };

export interface NotificationItem {
  id: string;
  provider: string;
  titleKey: string;
  detailKey: string;
  detailParams?: Record<string, number | string>;
  minutesAgo: number;
  read: boolean;
  target: NotificationTarget;
}

// Declared with an explicit element type (rather than `satisfies
// NotificationItem[]` inline) so each item's optional detailParams shape is
// checked directly against NotificationItem instead of TypeScript inferring
// a union of the individual literal shapes.
const notificationItems: NotificationItem[] = [
  { id: "n1", provider: "whatsapp", titleKey: "Overview.insightCollectionsTitle", detailKey: "Overview.remindersSentDetail", detailParams: { count: 3, channels: "WhatsApp Business" }, minutesAgo: 9, read: false, target: { kind: "reminderReceipt", insightId: "collections-gap" } },
  { id: "n2", provider: "whatsapp", titleKey: "InboxView.notifReplyDianaTitle", detailKey: "InboxView.notifReplyDianaDetail", minutesAgo: 15, read: false, target: { kind: "inboxThread", contactName: "Diana Ortiz" } },
  { id: "n3", provider: "apple_messages", titleKey: "InboxView.notifReplyMarcusTitle", detailKey: "InboxView.notifReplyMarcusDetail", minutesAgo: 22, read: false, target: { kind: "inboxThread", contactName: "Marcus Lee" } },
  { id: "n4", provider: "aval", titleKey: "Overview.insightMaintenanceTitle", detailKey: "Overview.notifDraftReadyDetail", minutesAgo: 31, read: false, target: { kind: "reviewDraft", insightId: "maintenance-sla" } },
  { id: "n5", provider: "aval", titleKey: "Overview.insightVacancyTitle", detailKey: "Overview.notifDraftReadyDetail", minutesAgo: 46, read: true, target: { kind: "reviewDraft", insightId: "vacancy-pricing" } },
  { id: "n6", provider: "quickbooks", titleKey: "DesktopApp.accountingSourceIncomplete", detailKey: "DesktopApp.notifAccountingDetail", detailParams: { minutes: 62 }, minutesAgo: 62, read: true, target: { kind: "connectionProvider", providerId: "quickbooks" } },
  { id: "n7", provider: "aval", titleKey: "Overview.insightNoiTitle", detailKey: "Overview.notifDraftReadyDetail", minutesAgo: 90, read: true, target: { kind: "reviewDraft", insightId: "noi-variance" } },
  { id: "n8", provider: "aval", titleKey: "Overview.notifWeeklySummaryTitle", detailKey: "Overview.notifWeeklySummaryDetail", minutesAgo: 130, read: true, target: { kind: "history" } },
];

/**
 * Every figure below is the single source of truth for the sample-mode Overview.
 * Nothing that is derivable (deltas, percentages, conversions) is stored as a
 * second, independently-authored value — it is computed by the derive* helpers
 * below and re-checked by assertSampleConsistency(). Text lives in the message
 * catalogs (messages/en.json, messages/es-mx.json) under the Overview
 * namespace; fields below reference it by key, they don't carry copy.
 */
export const sampleData = {
  updatedMinutesAgo: 4,
  portfolio: { units: 142, properties: 6 },
  noi: {
    labelKey: "Overview.noiLabel",
    detailKey: "Overview.noiDetail",
    value: 286410,
    priorValue: 273300,
    bars: [28, 38, 34, 51, 49, 62, 68],
    // Contributions must reconcile exactly to (value - priorValue) = 13110.
    // Checked in assertSampleConsistency() rather than trusted by inspection.
    attribution: [
      { driverKey: "Overview.driverRentCollected", amount: 18600 },
      { driverKey: "Overview.driverMaintenance", amount: -7200 },
      { driverKey: "Overview.driverOther", amount: 1710 },
    ] satisfies AttributionRow[],
  },
  economicOccupancy: {
    labelKey: "Overview.occupancyLabel",
    detailKey: "Overview.occupancyDetail",
    value: 94.2,
    priorValue: 93.0,
    bars: [51, 48, 55, 57, 62, 67, 72],
    evidenceRows: [
      { labelKey: "Overview.vacancyRomaSur6b", detailKey: "Overview.vacancyRomaSur6bDetail", amount: 21800 },
      { labelKey: "Overview.vacancyRomaSur8a", detailKey: "Overview.vacancyRomaSur8aDetail", amount: 19400 },
    ] satisfies EvidenceRow[],
  },
  rentCollected: {
    labelKey: "Overview.rentCollectedLabel",
    detailKey: "Overview.rentCollectedDetail",
    value: 612800,
    billed: 661900,
    bars: [18, 31, 42, 49, 61, 72, 78],
    evidenceRows: [
      { labelKey: "Overview.collectionsUnit3b", detailKey: "Overview.collectionsUnit3bDetail", amount: 12000 },
      { labelKey: "Overview.collectionsUnit5a", detailKey: "Overview.collectionsUnit5aDetail", amount: 9500 },
      { labelKey: "Overview.collectionsUnit7c", detailKey: "Overview.collectionsUnit7cDetail", amount: 7000 },
    ] satisfies EvidenceRow[],
  },
  openWorkOrders: {
    labelKey: "Overview.workOrdersLabel",
    detailKey: "Overview.workOrdersDetail",
    value: 18,
    urgent: 4,
    avgCloseDays: 2.7,
    bars: [72, 64, 60, 47, 43, 36, 31],
    evidenceRows: [
      { labelKey: "Overview.workOrderJardines22", detailKey: "Overview.workOrderJardines22Detail", amount: 2400 },
      { labelKey: "Overview.workOrderRomaSur2c", detailKey: "Overview.workOrderRomaSur2cDetail", amount: 1200 },
      { labelKey: "Overview.workOrderPaseoNorte", detailKey: "Overview.workOrderPaseoNorteDetail", amount: 500 },
    ] satisfies EvidenceRow[],
  },
  funnel: {
    stages: [
      { key: "contacted", labelKey: "Overview.stageContacted", count: 148 },
      { key: "viewed", labelKey: "Overview.stageViewed", count: 82 },
      { key: "applied", labelKey: "Overview.stageApplied", count: 37 },
      { key: "signed", labelKey: "Overview.stageSigned", count: 21 },
    ] satisfies FunnelStage[],
  },
  coverage: {
    rows: [
      { provider: "quickbooks", labelKey: "Overview.coverageAccountingLabel", detailKey: "Overview.coverageAccountingDetail", required: true },
      { provider: "appfolio", labelKey: "Overview.coverageLeasingLabel", detailKey: "Overview.coverageLeasingDetail", required: true },
      { provider: "whatsapp", labelKey: "Overview.coverageResidentLabel", detailKey: "Overview.coverageResidentDetail", required: false },
    ] satisfies CoverageRow[],
  },
  ledger: {
    steps: [
      { provider: "whatsapp", textKey: "Overview.ledgerSweep" },
      { provider: "slack", textKey: "Overview.ledgerFlag" },
      { provider: "twilio", textKey: "Overview.ledgerCall" },
      { provider: "complete", textKey: "Overview.ledgerComplete" },
    ] satisfies LedgerStep[],
  },
  // "History" in the Overview header opens this list — real itemized
  // entries, not a round hardcoded count with nothing behind it. Several
  // deliberately echo the insights above (a reminder batch, the pricing
  // draft, the maintenance dispatch) to show the ledger and the insight
  // queue are the same underlying activity, not two disconnected surfaces.
  history: {
    entries: [
      { id: "h1", provider: "whatsapp", textKey: "Overview.historySentReminders", minutesAgo: 9 },
      { id: "h2", provider: "twilio", textKey: "Overview.historyPaymentPlanCall", minutesAgo: 26 },
      { id: "h3", provider: "slack", textKey: "Overview.historyFlaggedAccounts", minutesAgo: 41 },
      { id: "h4", provider: "appfolio", textKey: "Overview.historyLeaseSigned", minutesAgo: 62 },
      { id: "h5", provider: "outlook", textKey: "Overview.historyVendorEstimate", minutesAgo: 130 },
      { id: "h6", provider: "quickbooks", textKey: "Overview.historyDepositsMatched", minutesAgo: 260 },
      { id: "h7", provider: "whatsapp", textKey: "Overview.historyViewingConfirmed", minutesAgo: 340 },
      { id: "h8", provider: "appfolio", textKey: "Overview.historyPricingDrafted", minutesAgo: 1080 },
      { id: "h9", provider: "twilio", textKey: "Overview.historyVendorDispatched", minutesAgo: 1500 },
      { id: "h10", provider: "slack", textKey: "Overview.historyNoiNotified", minutesAgo: 2600 },
    ] satisfies HistoryEntry[],
  },
  insights: {
    // More candidates than the queue shows (7) so the cap in rankInsights()
    // is doing real work, not just passing through everything.
    candidates: [
      {
        id: "collections-gap",
        tileKey: "rentCollected",
        titleKey: "Overview.insightCollectionsTitle",
        detailKey: "Overview.insightCollectionsDetail",
        moneyAtStake: 28500,
        urgency: 4,
        actionable: true,
        action: {
          type: "sendReminders",
          recipients: [
            { name: "Lucía R.", detailKey: "Overview.collectionsUnit3bDetail", amount: 12000, channel: "whatsapp" },
            { name: "Mateo S.", detailKey: "Overview.collectionsUnit5aDetail", amount: 9500, channel: "whatsapp" },
            { name: "Nora V.", detailKey: "Overview.collectionsUnit7cDetail", amount: 7000, channel: "whatsapp" },
          ],
        },
        evidence: [
          { labelKey: "Overview.collectionsUnit3b", detailKey: "Overview.collectionsUnit3bDetail", amount: 12000 },
          { labelKey: "Overview.collectionsUnit5a", detailKey: "Overview.collectionsUnit5aDetail", amount: 9500 },
          { labelKey: "Overview.collectionsUnit7c", detailKey: "Overview.collectionsUnit7cDetail", amount: 7000 },
        ],
      },
      {
        id: "vacancy-pricing",
        tileKey: "economicOccupancy",
        titleKey: "Overview.insightVacancyTitle",
        detailKey: "Overview.insightVacancyDetail",
        moneyAtStake: 41200,
        urgency: 2,
        actionable: true,
        action: { type: "draftPricingReview" },
        draftKey: "Overview.draftVacancyPricing",
        evidence: [
          { labelKey: "Overview.vacancyRomaSur6b", detailKey: "Overview.vacancyRomaSur6bDetail", amount: 21800 },
          { labelKey: "Overview.vacancyRomaSur8a", detailKey: "Overview.vacancyRomaSur8aDetail", amount: 19400 },
        ],
      },
      {
        id: "noi-variance",
        tileKey: "noi",
        titleKey: "Overview.insightNoiTitle",
        detailKey: "Overview.insightNoiDetail",
        moneyAtStake: 13110,
        urgency: 2,
        actionable: true,
        action: { type: "openReview" },
        draftKey: "Overview.draftNoiVariance",
        evidence: [],
      },
      {
        id: "maintenance-sla",
        tileKey: "openWorkOrders",
        titleKey: "Overview.insightMaintenanceTitle",
        detailKey: "Overview.insightMaintenanceDetail",
        moneyAtStake: 4100,
        urgency: 5,
        actionable: true,
        action: { type: "escalateMaintenance" },
        draftKey: "Overview.draftMaintenanceEscalation",
        evidence: [
          { labelKey: "Overview.workOrderJardines22", detailKey: "Overview.workOrderJardines22Detail", amount: 2400 },
          { labelKey: "Overview.workOrderRomaSur2c", detailKey: "Overview.workOrderRomaSur2cDetail", amount: 1200 },
          { labelKey: "Overview.workOrderPaseoNorte", detailKey: "Overview.workOrderPaseoNorteDetail", amount: 500 },
        ],
      },
      {
        id: "deposit-reconciliation",
        tileKey: null,
        titleKey: "Overview.insightDepositsTitle",
        detailKey: "Overview.insightDepositsDetail",
        moneyAtStake: 6000,
        urgency: 3,
        actionable: true,
        action: { type: "openReview" },
        draftKey: "Overview.draftDepositReconciliation",
        evidence: [
          { labelKey: "Overview.depositAug14", detailKey: "Overview.depositAug14Detail", amount: 2200 },
          { labelKey: "Overview.depositAug19", detailKey: "Overview.depositAug19Detail", amount: 1800 },
          { labelKey: "Overview.depositAug27", detailKey: "Overview.depositAug27Detail", amount: 2000 },
        ],
      },
      {
        id: "lease-renewal",
        tileKey: null,
        titleKey: "Overview.insightLeaseRenewalTitle",
        detailKey: "Overview.insightLeaseRenewalDetail",
        moneyAtStake: 2000,
        urgency: 1,
        actionable: true,
        action: { type: "openReview" },
        draftKey: "Overview.draftLeaseRenewal",
        evidence: [],
      },
      {
        // Not actionable — a chart, not an insight. Excluded by the hard gate
        // in rankInsights(), never just ranked low. Kept here to prove that.
        id: "occupancy-trend",
        tileKey: null,
        titleKey: "Overview.insightOccupancyTrendTitle",
        detailKey: "Overview.insightOccupancyTrendDetail",
        moneyAtStake: 0,
        urgency: 1,
        actionable: false,
        action: null,
        evidence: [],
      },
    ] satisfies InsightCandidate[],
  },
  // What tapping a notification opens. Every target names a specific record
  // (an insight id, a resident, a provider) that must actually exist
  // elsewhere in this file — checked in assertSampleConsistency() — rather
  // than a generic "go to this tab" link with nothing underneath it.
  notifications: {
    items: notificationItems,
  },
  // Per-tab data for Properties/Leasing/Maintenance/Accounting. Every array
  // sums to a figure declared elsewhere (portfolio counts, the funnel
  // snapshot, the maintenance "reported" count, or NOI) — checked in
  // assertSampleConsistency() rather than trusted by inspection.
  properties: {
    list: [
      { nameKey: "OperationsView.propertyFranklinHouse", units: 22, occupied: 21, readyForLeasing: 1 },
      { nameKey: "OperationsView.propertyMonroeCourt", units: 30, occupied: 29, readyForLeasing: 1 },
      { nameKey: "OperationsView.propertyUnionCourt", units: 18, occupied: 17, readyForLeasing: 1 },
      { nameKey: "OperationsView.propertyRomaSur", units: 26, occupied: 23, readyForLeasing: 2 },
      { nameKey: "OperationsView.propertyPaseoNorte", units: 24, occupied: 24, readyForLeasing: 0 },
      { nameKey: "OperationsView.propertyJardines22", units: 22, occupied: 20, readyForLeasing: 0 },
    ] satisfies PropertyRow[],
  },
  leasing: {
    // Six weeks, oldest first. The last week must equal the funnel snapshot
    // above — the funnel is this trend's most recent point, not a separate
    // figure someone could let drift.
    trend: [
      { labelKey: "OperationsView.week1", contacted: 118, viewed: 61, applied: 24, signed: 12 },
      { labelKey: "OperationsView.week2", contacted: 126, viewed: 68, applied: 27, signed: 14 },
      { labelKey: "OperationsView.week3", contacted: 131, viewed: 70, applied: 29, signed: 15 },
      { labelKey: "OperationsView.week4", contacted: 137, viewed: 74, applied: 31, signed: 17 },
      { labelKey: "OperationsView.week5", contacted: 142, viewed: 78, applied: 34, signed: 19 },
      { labelKey: "OperationsView.week6", contacted: 148, viewed: 82, applied: 37, signed: 21 },
    ] satisfies LeasingTrendWeek[],
  },
  maintenance: {
    // Four months, oldest first, as {year, month} rather than display text —
    // formatted client-side with Intl.DateTimeFormat against the active
    // locale instead of a hardcoded set of month-name message keys.
    months: [
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ],
    // Every countsByMonth array must have one entry per month above, and the
    // grand total across all categories and months must equal the "Reported"
    // figure derived below (31) — not a second, separately-typed 31.
    categories: [
      { categoryKey: "OperationsView.categoryPlumbing", countsByMonth: [2, 1, 2, 1] },
      { categoryKey: "OperationsView.categoryElectrical", countsByMonth: [1, 2, 1, 1] },
      { categoryKey: "OperationsView.categoryHvac", countsByMonth: [3, 2, 3, 2] },
      { categoryKey: "OperationsView.categoryAppliance", countsByMonth: [1, 1, 1, 1] },
      { categoryKey: "OperationsView.categoryStructural", countsByMonth: [1, 2, 1, 2] },
    ] satisfies MaintenanceCategoryRow[],
    assigned: 24,
    workDone: 18,
    completed: 16,
  },
  accounting: {
    // Total revenue splits into NOI plus every expense category below —
    // checked to reconcile exactly, the same discipline as noi.attribution.
    otherIncome: 24500,
    revenueSources: [
      { key: "rentBilled", labelKey: "OperationsView.revenueRentBilled", amount: 661900 },
      { key: "otherIncome", labelKey: "OperationsView.revenueOtherIncome", amount: 24500 },
    ] satisfies AccountingFlowNode[],
    expenses: [
      { key: "maintenance", labelKey: "OperationsView.expenseMaintenance", amount: 154000 },
      { key: "utilities", labelKey: "OperationsView.expenseUtilities", amount: 86000 },
      { key: "management", labelKey: "OperationsView.expenseManagement", amount: 65990 },
      { key: "taxes", labelKey: "OperationsView.expenseTaxes", amount: 52000 },
      { key: "insurance", labelKey: "OperationsView.expenseInsurance", amount: 42000 },
    ] satisfies AccountingFlowNode[],
  },
};

export function deriveRelativeDeltaPct(value: number, priorValue: number): number {
  return ((value - priorValue) / priorValue) * 100;
}

export function derivePointDeltaPct(value: number, priorValue: number): number {
  return value - priorValue;
}

export function deriveShareOfPct(value: number, whole: number): number {
  return (value / whole) * 100;
}

export function deriveFunnelConversionPct(stages: readonly FunnelStage[], fromKey: FunnelStage["key"], toKey: FunnelStage["key"]): number {
  const from = stages.find((stage) => stage.key === fromKey);
  const to = stages.find((stage) => stage.key === toKey);
  if (!from || !to) throw new Error(`Unknown funnel stage pair: ${fromKey} -> ${toKey}`);
  return (to.count / from.count) * 100;
}

export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export const MAX_ACTIVE_INSIGHTS = 5;

/**
 * Actionability is a hard gate, not a weight: a candidate with no bound
 * action is excluded outright, never ranked low. Survivors are ranked by
 * money at stake × urgency and capped at MAX_ACTIVE_INSIGHTS.
 */
export function rankInsights(candidates: readonly InsightCandidate[]): InsightCandidate[] {
  return candidates
    .filter((candidate) => candidate.actionable && candidate.action !== null)
    .slice()
    .sort((a, b) => b.moneyAtStake * b.urgency - a.moneyAtStake * a.urgency)
    .slice(0, MAX_ACTIVE_INSIGHTS);
}

export function sumAmounts(rows: readonly { amount: number }[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

export function derivePropertyTotals(list: readonly PropertyRow[]) {
  return {
    properties: list.length,
    units: list.reduce((total, row) => total + row.units, 0),
    occupied: list.reduce((total, row) => total + row.occupied, 0),
    readyForLeasing: list.reduce((total, row) => total + row.readyForLeasing, 0),
  };
}

export function deriveMaintenanceReported(categories: readonly MaintenanceCategoryRow[]): number {
  return categories.reduce((total, row) => total + row.countsByMonth.reduce((sum, count) => sum + count, 0), 0);
}

export function deriveAccountingTotals() {
  const totalRevenue = sumAmounts(sampleData.accounting.revenueSources);
  const totalExpenses = sumAmounts(sampleData.accounting.expenses);
  return { totalRevenue, totalExpenses };
}

export const derivedSample = {
  noiDeltaPct: deriveRelativeDeltaPct(sampleData.noi.value, sampleData.noi.priorValue),
  occupancyDeltaPct: derivePointDeltaPct(sampleData.economicOccupancy.value, sampleData.economicOccupancy.priorValue),
  rentCollectedPct: deriveShareOfPct(sampleData.rentCollected.value, sampleData.rentCollected.billed),
  contactedToViewedPct: deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "viewed"),
  contactedToSignedPct: deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "signed"),
};

/**
 * Regression guard: fails if a derived figure in `derivedSample` no longer
 * matches what its raw inputs in `sampleData` compute to (e.g. someone edits
 * a raw count without recomputing, or hand-overrides a derived field).
 */
export function assertSampleConsistency(): void {
  const fresh = {
    noiDeltaPct: deriveRelativeDeltaPct(sampleData.noi.value, sampleData.noi.priorValue),
    occupancyDeltaPct: derivePointDeltaPct(sampleData.economicOccupancy.value, sampleData.economicOccupancy.priorValue),
    rentCollectedPct: deriveShareOfPct(sampleData.rentCollected.value, sampleData.rentCollected.billed),
    contactedToViewedPct: deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "viewed"),
    contactedToSignedPct: deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "signed"),
  };

  for (const key of Object.keys(fresh) as (keyof typeof fresh)[]) {
    if (Math.abs(fresh[key] - derivedSample[key]) > 1e-9) {
      throw new Error(`Sample data drift: ${key} recomputes to ${fresh[key]} but derivedSample has ${derivedSample[key]}`);
    }
  }

  const viewed = sampleData.funnel.stages.find((stage) => stage.key === "viewed")!.count;
  const applied = sampleData.funnel.stages.find((stage) => stage.key === "applied")!.count;
  const signed = sampleData.funnel.stages.find((stage) => stage.key === "signed")!.count;
  if (!(viewed >= applied && applied >= signed)) {
    throw new Error("Sample funnel stages are not monotonically decreasing");
  }

  // NOI attribution must reconcile exactly to the tile's own delta. This is
  // the P2.2 requirement made literal: no bare delta without a breakdown that
  // actually sums to it.
  const noiDelta = sampleData.noi.value - sampleData.noi.priorValue;
  const attributed = sumAmounts(sampleData.noi.attribution);
  if (attributed !== noiDelta) {
    throw new Error(`NOI attribution sums to ${attributed} but the tile delta is ${noiDelta} — add a residual row or fix an amount`);
  }

  // Insight evidence must sum to the money-at-stake figure it justifies —
  // otherwise "evidence" is decoration, not a real drill-down.
  for (const candidate of sampleData.insights.candidates) {
    if (candidate.evidence.length === 0) continue;
    const evidenceTotal = sumAmounts(candidate.evidence);
    if (evidenceTotal !== candidate.moneyAtStake) {
      throw new Error(`Insight "${candidate.id}" evidence sums to ${evidenceTotal} but moneyAtStake is ${candidate.moneyAtStake}`);
    }
  }

  // The cap must be doing real work: more actionable candidates exist than
  // the queue shows, and the hard gate excludes the non-actionable one
  // entirely rather than just ranking it low.
  const actionableCount = sampleData.insights.candidates.filter((candidate) => candidate.actionable).length;
  if (actionableCount <= MAX_ACTIVE_INSIGHTS) {
    throw new Error("Sample insight candidates no longer exceed the queue cap — the cap logic isn't being exercised");
  }
  const ranked = rankInsights(sampleData.insights.candidates);
  if (ranked.length !== MAX_ACTIVE_INSIGHTS) {
    throw new Error(`rankInsights should return exactly ${MAX_ACTIVE_INSIGHTS} insights, got ${ranked.length}`);
  }
  if (ranked.some((insight) => !insight.actionable)) {
    throw new Error("A non-actionable candidate made it through rankInsights — the hard gate isn't excluding it");
  }

  // A tile's evidenceRows and its matching insight's evidence are authored
  // separately (one drives the tile drill-down, the other the insight card)
  // but describe the same underlying records, so they must stay identical.
  const tilesWithEvidence = { noi: null, economicOccupancy: sampleData.economicOccupancy, rentCollected: sampleData.rentCollected, openWorkOrders: sampleData.openWorkOrders } as const;
  for (const candidate of sampleData.insights.candidates) {
    if (!candidate.tileKey || candidate.evidence.length === 0) continue;
    const tile = tilesWithEvidence[candidate.tileKey];
    const tileEvidence = tile && "evidenceRows" in tile ? tile.evidenceRows : undefined;
    if (JSON.stringify(tileEvidence) !== JSON.stringify(candidate.evidence)) {
      throw new Error(`Insight "${candidate.id}" evidence has drifted from sampleData.${candidate.tileKey}.evidenceRows`);
    }
  }

  // Properties tab: the per-property roster must sum to the portfolio
  // counts already declared in sampleData.portfolio, not a second figure.
  const propertyTotals = derivePropertyTotals(sampleData.properties.list);
  if (propertyTotals.units !== sampleData.portfolio.units) {
    throw new Error(`Properties list sums to ${propertyTotals.units} units but portfolio.units is ${sampleData.portfolio.units}`);
  }
  if (propertyTotals.properties !== sampleData.portfolio.properties) {
    throw new Error(`Properties list has ${propertyTotals.properties} entries but portfolio.properties is ${sampleData.portfolio.properties}`);
  }

  // Leasing tab trend: the most recent week is the funnel snapshot itself,
  // not an independently-authored figure that could quietly diverge from it.
  const latestWeek = sampleData.leasing.trend.at(-1)!;
  const funnelByKey = Object.fromEntries(sampleData.funnel.stages.map((stage) => [stage.key, stage.count]));
  if (
    latestWeek.contacted !== funnelByKey.contacted ||
    latestWeek.viewed !== funnelByKey.viewed ||
    latestWeek.applied !== funnelByKey.applied ||
    latestWeek.signed !== funnelByKey.signed
  ) {
    throw new Error("Leasing trend's latest week does not match the funnel snapshot in sampleData.funnel.stages");
  }
  for (const week of sampleData.leasing.trend) {
    if (!(week.contacted >= week.viewed && week.viewed >= week.applied && week.applied >= week.signed)) {
      throw new Error(`Leasing trend week "${week.labelKey}" is not monotonically decreasing (contacted >= viewed >= applied >= signed)`);
    }
  }

  // Maintenance tab: the category-by-month matrix must have one count per
  // declared month, and its grand total is what "reported" actually means —
  // not a separate hand-typed number.
  for (const category of sampleData.maintenance.categories) {
    if (category.countsByMonth.length !== sampleData.maintenance.months.length) {
      throw new Error(`Maintenance category "${category.categoryKey}" has ${category.countsByMonth.length} month entries but there are ${sampleData.maintenance.months.length} declared months`);
    }
  }
  const reported = deriveMaintenanceReported(sampleData.maintenance.categories);
  if (!(reported >= sampleData.maintenance.assigned && sampleData.maintenance.assigned >= sampleData.maintenance.workDone && sampleData.maintenance.workDone >= sampleData.maintenance.completed)) {
    throw new Error("Maintenance funnel is not monotonically decreasing (reported >= assigned >= workDone >= completed)");
  }

  // Accounting tab: total revenue must equal NOI plus every expense
  // category — the same reconciliation discipline as noi.attribution, so
  // the Sankey's nodes can't silently stop summing to the numbers already
  // shown on the Overview.
  const { totalRevenue, totalExpenses } = deriveAccountingTotals();
  if (totalRevenue - totalExpenses !== sampleData.noi.value) {
    throw new Error(`Accounting revenue (${totalRevenue}) minus expenses (${totalExpenses}) is ${totalRevenue - totalExpenses}, but does not equal noi.value (${sampleData.noi.value})`);
  }

  // Every notification that deep-links to a drafted review or a sent-reminder
  // receipt must point at an insight that actually exists — a broken id would
  // silently render an empty dialog instead of the promised content.
  for (const item of sampleData.notifications.items) {
    const target = item.target;
    if (target.kind !== "reviewDraft" && target.kind !== "reminderReceipt") continue;
    const insight = sampleData.insights.candidates.find((candidate) => candidate.id === target.insightId);
    if (!insight) {
      throw new Error(`Notification "${item.id}" targets insight "${target.insightId}" which does not exist`);
    }
    if (target.kind === "reminderReceipt" && insight.action?.type === "sendReminders" && typeof item.detailParams?.count === "number" && item.detailParams.count !== insight.action.recipients.length) {
      throw new Error(`Notification "${item.id}" claims ${item.detailParams.count} recipients but insight "${insight.id}" has ${insight.action.recipients.length}`);
    }
  }
}
