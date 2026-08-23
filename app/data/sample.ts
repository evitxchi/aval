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
  },
  economicOccupancy: {
    labelKey: "Overview.occupancyLabel",
    detailKey: "Overview.occupancyDetail",
    value: 94.2,
    priorValue: 93.0,
    bars: [51, 48, 55, 57, 62, 67, 72],
  },
  rentCollected: {
    labelKey: "Overview.rentCollectedLabel",
    detailKey: "Overview.rentCollectedDetail",
    value: 612800,
    billed: 661900,
    bars: [18, 31, 42, 49, 61, 72, 78],
  },
  openWorkOrders: {
    labelKey: "Overview.workOrdersLabel",
    detailKey: "Overview.workOrdersDetail",
    value: 18,
    urgent: 4,
    avgCloseDays: 2.7,
    bars: [72, 64, 60, 47, 43, 36, 31],
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
}
