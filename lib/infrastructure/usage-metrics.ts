/**
 * Pure utility-usage derivations, in the same style as
 * app/data/sample.ts's derive* helpers (a plain percent number like `4.8`,
 * never a `0.048` fraction) so infrastructure figures read consistently
 * with the rest of the dashboard.
 *
 * `compareBaselineToReporting` is a deliberately simplified stand-in for
 * the industry-standard CalTRACK/eemeter methodology (see docs/DECISIONS.md)
 * for measuring energy savings: real CalTRACK normalizes for weather
 * (heating/cooling degree days) via regression against a billing-period
 * baseline, which needs a weather-data source Aval doesn't have yet. This
 * normalizes only for period length (average usage per day), which is
 * honest but weaker — a mild winter will look like a real reduction. Swap
 * in degree-day-weighted regression here once a weather source is
 * connected, without changing this function's signature.
 */

export interface UtilityPeriod {
  usageAmount: number;
  periodStart: Date;
  periodEnd: Date;
}

export function costPerUsageUnit(bill: { costCents: number; usageAmount: number }): number {
  if (bill.usageAmount <= 0) throw new Error("costPerUsageUnit: usageAmount must be positive");
  return bill.costCents / bill.usageAmount;
}

/** Usage per square foot — the standard "energy use intensity" shape, generalized to any utility. */
export function usageIntensityPerSqft(usageAmount: number, squareFeet: number): number {
  if (squareFeet <= 0) throw new Error("usageIntensityPerSqft: squareFeet must be positive");
  return usageAmount / squareFeet;
}

/** Percent change of `current` over `baseline` — identical shape to app/data/sample.ts's deriveRelativeDeltaPct. */
export function usageVariancePct(current: number, baseline: number): number {
  if (baseline === 0) throw new Error("usageVariancePct: baseline must be non-zero");
  return ((current - baseline) / baseline) * 100;
}

function periodDays(period: UtilityPeriod): number {
  const ms = period.periodEnd.getTime() - period.periodStart.getTime();
  if (ms <= 0) throw new Error("periodDays: periodEnd must be after periodStart");
  return ms / (1000 * 60 * 60 * 24);
}

export function averageDailyUsage(period: UtilityPeriod): number {
  return period.usageAmount / periodDays(period);
}

export interface BaselineComparison {
  baselineDailyAverage: number;
  reportingDailyAverage: number;
  variancePct: number;
}

export function compareBaselineToReporting(baseline: UtilityPeriod, reporting: UtilityPeriod): BaselineComparison {
  const baselineDailyAverage = averageDailyUsage(baseline);
  const reportingDailyAverage = averageDailyUsage(reporting);
  return {
    baselineDailyAverage,
    reportingDailyAverage,
    variancePct: usageVariancePct(reportingDailyAverage, baselineDailyAverage),
  };
}

/** Sum of usage across bills whose period starts within the trailing 365 days of `asOf` (default now). */
export function annualizedUsage(bills: UtilityPeriod[], asOf: Date = new Date()): number {
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - 365);
  return bills.filter((bill) => bill.periodStart >= cutoff && bill.periodStart <= asOf).reduce((total, bill) => total + bill.usageAmount, 0);
}
