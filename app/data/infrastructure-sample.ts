/**
 * Sample data for the Infrastructure dashboard view — same discipline as
 * sample.ts: raw inputs live here once, every displayed figure is derived
 * from them (via lib/infrastructure/usage-metrics.ts and lib/finance/money.ts,
 * the exact libraries the real /api/infrastructure/summary route uses), and
 * a consistency check (tests/infrastructure-sample-data.test.ts) guards
 * against a derived figure drifting from its inputs. Kept in its own file
 * rather than folded into sample.ts's `sampleData`/`assertSampleConsistency`
 * — this is genuinely new, unrelated ground (see docs/DECISIONS.md), and
 * sample.ts is large enough already.
 */

// Relative imports (not the usual "@/..." alias) so this module — and its
// test — can be resolved by plain `node --test`, which doesn't understand
// tsconfig path aliases the way the Vite/vinext build does.
import { compareBaselineToReporting, costPerUsageUnit } from "../../lib/infrastructure/usage-metrics.ts";
import { formatMoney } from "../../lib/finance/money.ts";
import type { UtilityType } from "../../lib/infrastructure/types.ts";

interface SamplePeriod {
  usageAmount: number;
  periodStart: Date;
  periodEnd: Date;
  costCents: number;
}

interface UtilityRawData {
  utilityType: UtilityType;
  unitOfMeasure: string;
  meterCount: number;
  billCount: number;
  priorPeriod: SamplePeriod;
  currentPeriod: SamplePeriod;
}

export const infrastructureRawData: UtilityRawData[] = [
  {
    utilityType: "electricity",
    unitOfMeasure: "kWh",
    meterCount: 6,
    billCount: 12,
    priorPeriod: { usageAmount: 45_100, periodStart: new Date("2026-06-19"), periodEnd: new Date("2026-07-19"), costCents: 721_600 },
    currentPeriod: { usageAmount: 42_800, periodStart: new Date("2026-07-19"), periodEnd: new Date("2026-08-18"), costCents: 684_800 },
  },
  {
    utilityType: "water",
    unitOfMeasure: "gal",
    meterCount: 6,
    billCount: 12,
    priorPeriod: { usageAmount: 179_500, periodStart: new Date("2026-06-19"), periodEnd: new Date("2026-07-19"), costCents: 206_800 },
    currentPeriod: { usageAmount: 186_000, periodStart: new Date("2026-07-19"), periodEnd: new Date("2026-08-18"), costCents: 214_900 },
  },
];

export interface InfrastructureSummaryRow {
  utilityType: UtilityType;
  unitOfMeasure: string;
  meterCount: number;
  billCount: number;
  totalCostFormatted: string;
  totalUsage: number;
  costPerUnit: number;
  usageVariancePct: number;
}

export function deriveInfrastructureSummary(rows: UtilityRawData[] = infrastructureRawData): InfrastructureSummaryRow[] {
  return rows.map((row) => ({
    utilityType: row.utilityType,
    unitOfMeasure: row.unitOfMeasure,
    meterCount: row.meterCount,
    billCount: row.billCount,
    totalCostFormatted: formatMoney(row.currentPeriod.costCents, "USD"),
    totalUsage: row.currentPeriod.usageAmount,
    costPerUnit: costPerUsageUnit(row.currentPeriod),
    usageVariancePct: compareBaselineToReporting(row.priorPeriod, row.currentPeriod).variancePct,
  }));
}

export const infrastructureSummary = deriveInfrastructureSummary();
