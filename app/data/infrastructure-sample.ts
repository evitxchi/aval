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
import { estimatedPipeSizeInches, FIXTURE_UNIT_TABLE, totalFixtureUnits, type FixtureCount, type FixtureType } from "../../lib/infrastructure/plumbing.ts";

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

// ---------------------------------------------------------------------------
// Building systems, compliance, preventive maintenance and capital planning.
//
// Utility spend alone isn't "infrastructure" to a property manager — it's the
// one part that arrives as a bill. The rest of the job is knowing what
// equipment exists, how close it is to the end of its life, what inspections
// are legally due, and what has to be funded in which year. Same discipline as
// above: raw facts here, every displayed figure derived, nothing formatted by
// hand.
// ---------------------------------------------------------------------------

/** Anchor for every "due in N days" figure below, matching SAMPLE_TODAY in the dashboard. */
export const INFRA_TODAY = new Date(2026, 7, 18);

export type AssetCategory = "hvac" | "plumbing" | "electrical" | "envelope" | "safety" | "conveyance";

/** Where an asset sits on the run from new to end-of-life. */
export type AssetCondition = "good" | "monitor" | "plan" | "urgent";

interface BuildingAssetRaw {
  id: string;
  labelKey: string;
  category: AssetCategory;
  propertyKey: string;
  locationKey: string;
  installedYear: number;
  /** Published service life for this class of equipment (ASHRAE-style estimates). */
  expectedLifeYears: number;
  replacementCostCents: number;
  lastServicedMonthsAgo: number;
}

export const buildingAssetsRawData: BuildingAssetRaw[] = [
  { id: "a1", labelKey: "InfrastructureView.assetRooftopUnit", category: "hvac", propertyKey: "InfrastructureView.propertyRiverside", locationKey: "InfrastructureView.locationRoof", installedYear: 2009, expectedLifeYears: 20, replacementCostCents: 4_850_000, lastServicedMonthsAgo: 4 },
  { id: "a2", labelKey: "InfrastructureView.assetBoiler", category: "hvac", propertyKey: "InfrastructureView.propertyRiverside", locationKey: "InfrastructureView.locationBasement", installedYear: 2004, expectedLifeYears: 25, replacementCostCents: 7_200_000, lastServicedMonthsAgo: 2 },
  { id: "a3", labelKey: "InfrastructureView.assetElevator", category: "conveyance", propertyKey: "InfrastructureView.propertyRiverside", locationKey: "InfrastructureView.locationCore", installedYear: 1998, expectedLifeYears: 30, replacementCostCents: 18_500_000, lastServicedMonthsAgo: 1 },
  { id: "a4", labelKey: "InfrastructureView.assetWaterHeater", category: "plumbing", propertyKey: "InfrastructureView.propertyOakGrove", locationKey: "InfrastructureView.locationMechanical", installedYear: 2016, expectedLifeYears: 12, replacementCostCents: 1_450_000, lastServicedMonthsAgo: 7 },
  { id: "a5", labelKey: "InfrastructureView.assetRoof", category: "envelope", propertyKey: "InfrastructureView.propertyOakGrove", locationKey: "InfrastructureView.locationRoof", installedYear: 2011, expectedLifeYears: 22, replacementCostCents: 12_900_000, lastServicedMonthsAgo: 14 },
  { id: "a6", labelKey: "InfrastructureView.assetFirePanel", category: "safety", propertyKey: "InfrastructureView.propertyRiverside", locationKey: "InfrastructureView.locationLobby", installedYear: 2013, expectedLifeYears: 15, replacementCostCents: 2_300_000, lastServicedMonthsAgo: 3 },
  { id: "a7", labelKey: "InfrastructureView.assetSwitchgear", category: "electrical", propertyKey: "InfrastructureView.propertyOakGrove", locationKey: "InfrastructureView.locationMechanical", installedYear: 2002, expectedLifeYears: 30, replacementCostCents: 9_600_000, lastServicedMonthsAgo: 11 },
  { id: "a8", labelKey: "InfrastructureView.assetSumpPumps", category: "plumbing", propertyKey: "InfrastructureView.propertyRiverside", locationKey: "InfrastructureView.locationBasement", installedYear: 2019, expectedLifeYears: 10, replacementCostCents: 620_000, lastServicedMonthsAgo: 5 },
];

export interface BuildingAssetRow {
  id: string;
  labelKey: string;
  category: AssetCategory;
  propertyKey: string;
  locationKey: string;
  ageYears: number;
  expectedLifeYears: number;
  /** Years left before the published service life runs out. Negative once it's past due. */
  remainingLifeYears: number;
  /** How much of the service life is used up, as a percentage. Can exceed 100. */
  lifeConsumedPct: number;
  condition: AssetCondition;
  replacementYear: number;
  replacementCostCents: number;
  replacementCostFormatted: string;
  /** What this asset alone should be adding to reserves each year to fund its own replacement. */
  annualReserveCents: number;
  annualReserveFormatted: string;
  lastServicedMonthsAgo: number;
}

/**
 * Condition is a read of remaining service life, not a subjective grade — so
 * two managers looking at the same register agree on what "urgent" means.
 */
export function assetCondition(lifeConsumedPct: number): AssetCondition {
  if (lifeConsumedPct >= 100) return "urgent";
  if (lifeConsumedPct >= 85) return "plan";
  if (lifeConsumedPct >= 65) return "monitor";
  return "good";
}

export function deriveBuildingAssets(rows: BuildingAssetRaw[] = buildingAssetsRawData, asOf: Date = INFRA_TODAY): BuildingAssetRow[] {
  return rows.map((row) => {
    const ageYears = asOf.getFullYear() - row.installedYear;
    const remainingLifeYears = row.expectedLifeYears - ageYears;
    const lifeConsumedPct = (ageYears / row.expectedLifeYears) * 100;
    const annualReserveCents = Math.round(row.replacementCostCents / row.expectedLifeYears);
    return {
      id: row.id,
      labelKey: row.labelKey,
      category: row.category,
      propertyKey: row.propertyKey,
      locationKey: row.locationKey,
      ageYears,
      expectedLifeYears: row.expectedLifeYears,
      remainingLifeYears,
      lifeConsumedPct,
      condition: assetCondition(lifeConsumedPct),
      replacementYear: row.installedYear + row.expectedLifeYears,
      replacementCostCents: row.replacementCostCents,
      replacementCostFormatted: formatMoney(row.replacementCostCents, "USD"),
      annualReserveCents,
      annualReserveFormatted: formatMoney(annualReserveCents, "USD"),
      lastServicedMonthsAgo: row.lastServicedMonthsAgo,
    };
  });
}

export const buildingAssets = deriveBuildingAssets();

/** Where a recurring obligation stands relative to its due date. */
export type DueStatus = "current" | "dueSoon" | "overdue";

interface ComplianceItemRaw {
  id: string;
  labelKey: string;
  /** Who requires it — the answer to "says who?" when a manager questions the line. */
  authorityKey: string;
  propertyKey: string;
  cadenceMonths: number;
  lastCompletedDaysAgo: number;
}

export const complianceRawData: ComplianceItemRaw[] = [
  { id: "c1", labelKey: "InfrastructureView.complianceFireAlarm", authorityKey: "InfrastructureView.authorityFireMarshal", propertyKey: "InfrastructureView.propertyRiverside", cadenceMonths: 12, lastCompletedDaysAgo: 402 },
  { id: "c2", labelKey: "InfrastructureView.complianceElevatorCert", authorityKey: "InfrastructureView.authorityStateElevator", propertyKey: "InfrastructureView.propertyRiverside", cadenceMonths: 12, lastCompletedDaysAgo: 341 },
  { id: "c3", labelKey: "InfrastructureView.complianceBackflow", authorityKey: "InfrastructureView.authorityWaterDistrict", propertyKey: "InfrastructureView.propertyOakGrove", cadenceMonths: 12, lastCompletedDaysAgo: 298 },
  { id: "c4", labelKey: "InfrastructureView.complianceSprinkler", authorityKey: "InfrastructureView.authorityFireMarshal", propertyKey: "InfrastructureView.propertyOakGrove", cadenceMonths: 3, lastCompletedDaysAgo: 66 },
  { id: "c5", labelKey: "InfrastructureView.complianceBoilerCert", authorityKey: "InfrastructureView.authorityStateBoiler", propertyKey: "InfrastructureView.propertyRiverside", cadenceMonths: 12, lastCompletedDaysAgo: 190 },
  { id: "c6", labelKey: "InfrastructureView.complianceEmergencyLighting", authorityKey: "InfrastructureView.authorityBuildingCode", propertyKey: "InfrastructureView.propertyOakGrove", cadenceMonths: 1, lastCompletedDaysAgo: 12 },
];

export interface ComplianceRow {
  id: string;
  labelKey: string;
  authorityKey: string;
  propertyKey: string;
  cadenceMonths: number;
  lastCompleted: Date;
  dueDate: Date;
  /** Negative once the due date has passed. */
  daysUntilDue: number;
  status: DueStatus;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Anything already past its date is overdue; inside 30 days is the window in
 * which scheduling an inspector is still realistic, so that's "due soon".
 */
export function dueStatus(daysUntilDue: number): DueStatus {
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 30) return "dueSoon";
  return "current";
}

export function deriveCompliance(rows: ComplianceItemRaw[] = complianceRawData, asOf: Date = INFRA_TODAY): ComplianceRow[] {
  return rows
    .map((row) => {
      const lastCompleted = new Date(asOf.getTime() - row.lastCompletedDaysAgo * MS_PER_DAY);
      const dueDate = new Date(lastCompleted);
      dueDate.setMonth(dueDate.getMonth() + row.cadenceMonths);
      const daysUntilDue = Math.round((dueDate.getTime() - asOf.getTime()) / MS_PER_DAY);
      return { id: row.id, labelKey: row.labelKey, authorityKey: row.authorityKey, propertyKey: row.propertyKey, cadenceMonths: row.cadenceMonths, lastCompleted, dueDate, daysUntilDue, status: dueStatus(daysUntilDue) };
    })
    // Soonest first — an inspection list is only useful in the order you have
    // to act on it, and the overdue ones sort to the top for free.
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export const complianceItems = deriveCompliance();

interface PreventiveTaskRaw {
  id: string;
  labelKey: string;
  category: AssetCategory;
  cadenceDays: number;
  lastDoneDaysAgo: number;
}

export const preventiveRawData: PreventiveTaskRaw[] = [
  { id: "p1", labelKey: "InfrastructureView.pmFilterChange", category: "hvac", cadenceDays: 90, lastDoneDaysAgo: 84 },
  { id: "p2", labelKey: "InfrastructureView.pmDrainFlush", category: "plumbing", cadenceDays: 180, lastDoneDaysAgo: 192 },
  { id: "p3", labelKey: "InfrastructureView.pmGeneratorTest", category: "electrical", cadenceDays: 30, lastDoneDaysAgo: 22 },
  { id: "p4", labelKey: "InfrastructureView.pmGutterClear", category: "envelope", cadenceDays: 180, lastDoneDaysAgo: 151 },
  { id: "p5", labelKey: "InfrastructureView.pmExtinguisherCheck", category: "safety", cadenceDays: 30, lastDoneDaysAgo: 31 },
  { id: "p6", labelKey: "InfrastructureView.pmElevatorLubrication", category: "conveyance", cadenceDays: 90, lastDoneDaysAgo: 61 },
];

export interface PreventiveTaskRow {
  id: string;
  labelKey: string;
  category: AssetCategory;
  cadenceDays: number;
  daysUntilDue: number;
  status: DueStatus;
}

export function derivePreventiveTasks(rows: PreventiveTaskRaw[] = preventiveRawData): PreventiveTaskRow[] {
  return rows
    .map((row) => {
      const daysUntilDue = row.cadenceDays - row.lastDoneDaysAgo;
      return { id: row.id, labelKey: row.labelKey, category: row.category, cadenceDays: row.cadenceDays, daysUntilDue, status: dueStatus(daysUntilDue) };
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export const preventiveTasks = derivePreventiveTasks();

export interface CapitalForecastYear {
  year: number;
  /** Replacements whose published service life expires in this year. */
  assetIds: string[];
  totalCents: number;
  totalFormatted: string;
}

/**
 * The register read forward: what falls due in which year, so a reserve study
 * or a board conversation starts from the equipment rather than from a flat
 * per-door guess. Years with nothing due are kept so the run of years reads as
 * a timeline instead of a list that silently skips the quiet years.
 */
export function deriveCapitalForecast(rows: BuildingAssetRow[] = buildingAssets, asOf: Date = INFRA_TODAY, horizonYears = 10): CapitalForecastYear[] {
  const startYear = asOf.getFullYear();
  const years: CapitalForecastYear[] = [];
  for (let offset = 0; offset < horizonYears; offset += 1) {
    const year = startYear + offset;
    // Anything already past its replacement year is pulled into the first
    // column rather than dropped off the back of the chart — deferred capital
    // is still owed, and hiding it is how it gets forgotten.
    const due = rows.filter((row) => (offset === 0 ? row.replacementYear <= year : row.replacementYear === year));
    const totalCents = due.reduce((sum, row) => sum + row.replacementCostCents, 0);
    years.push({ year, assetIds: due.map((row) => row.id), totalCents, totalFormatted: formatMoney(totalCents, "USD") });
  }
  return years;
}

export const capitalForecast = deriveCapitalForecast();

/** Total a portfolio should be setting aside each year across every tracked asset. */
export function totalAnnualReserveCents(rows: BuildingAssetRow[] = buildingAssets): number {
  return rows.reduce((sum, row) => sum + row.annualReserveCents, 0);
}

// The plumbing library has been in lib/ since the infrastructure module landed
// but nothing ever surfaced it. Fixture-unit load is what tells a manager
// whether a riser can take another unit's worth of fixtures before a
// renovation, so it belongs on this page rather than sitting unused.
export const fixtureInventory: FixtureCount[] = [
  { type: "waterCloset", count: 96 },
  { type: "lavatory", count: 96 },
  { type: "bathtub", count: 64 },
  { type: "shower", count: 32 },
  { type: "kitchenSink", count: 48 },
  { type: "dishwasher", count: 48 },
  { type: "clothesWasher", count: 12 },
  { type: "hoseBib", count: 6 },
];

/** Largest load the published band table covers; past this the estimate is a fallback, not an answer. */
export const FIXTURE_UNIT_TABLE_CEILING = 450;

export interface FixtureLoadSummary {
  totalUnits: number;
  estimatedPipeSizeInches: number;
  /**
   * True when the load runs past the band table, in which case
   * `estimatedPipeSizeInches` is the top band repeated rather than a real
   * sizing. The view must say so instead of printing the number plainly —
   * plumbing.ts documents this case as needing engineering review.
   */
  beyondTableRange: boolean;
  fixtures: { type: FixtureType; count: number; unitsEach: number; unitsTotal: number }[];
}

export function deriveFixtureLoad(fixtures: FixtureCount[] = fixtureInventory): FixtureLoadSummary {
  // WSFU tables are published to one decimal; summing floats like 2.2 and 1.4
  // otherwise surfaces as 701.4000000000001 in the UI.
  const totalUnits = Math.round(totalFixtureUnits(fixtures) * 10) / 10;
  return {
    totalUnits,
    estimatedPipeSizeInches: estimatedPipeSizeInches(totalUnits),
    beyondTableRange: totalUnits > FIXTURE_UNIT_TABLE_CEILING,
    fixtures: fixtures.map((fixture) => ({
      type: fixture.type,
      count: fixture.count,
      unitsEach: FIXTURE_UNIT_TABLE[fixture.type],
      unitsTotal: FIXTURE_UNIT_TABLE[fixture.type] * fixture.count,
    })).sort((a, b) => b.unitsTotal - a.unitsTotal),
  };
}

export const fixtureLoad = deriveFixtureLoad();
