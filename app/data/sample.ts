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
}

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
        evidence: [],
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
}
