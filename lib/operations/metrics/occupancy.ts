/**
 * Occupancy, vacancy and rent-position maths for the Properties tab.
 *
 * Pure functions over row shapes, deliberately taking plain objects rather
 * than reading the database, for the same reason `lib/finance/metrics.ts` is
 * written this way: the formulas can then be pinned by tests that run under
 * `node --test` with no Cloudflare D1 binding, and every figure the app shows
 * traces to an expression a reader can check.
 *
 * The recurring rule: a metric returns `null` when the inputs cannot support
 * it, never a zero standing in for "unknown".
 */

import {
  OCCUPIED_UNIT_STATUSES,
  RENTABLE_UNIT_STATUSES,
  VACANCY_THRESHOLD_DAYS,
  average,
  daysBetween,
  percentOf,
  round,
  type UnitStatus,
} from "../types.ts";

export interface UnitLike {
  id: string;
  propertyId: string;
  status: UnitStatus;
  marketRentCents: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  vacantSince: Date | null;
}

export interface ActiveLeaseLike {
  unitId: string;
  rentCents: number;
}

export interface OccupancySummary {
  totalUnits: number;
  /** Units available to be leased at all — excludes `down`, which is out of service rather than vacant. */
  rentableUnits: number;
  occupiedUnits: number;
  /** Occupied but on notice: still paying, not available. Counted in occupancy, called out separately because it is next month's vacancy. */
  noticeUnits: number;
  vacantReadyUnits: number;
  vacantNotReadyUnits: number;
  downUnits: number;
  /** Occupied ÷ rentable. Null for a portfolio with no rentable units — not 0%. */
  physicalOccupancyPct: number | null;
  /** Units a prospect could actually move into today. */
  availableToLeaseUnits: number;
}

export function summarizeOccupancy(units: UnitLike[]): OccupancySummary {
  const countOf = (status: UnitStatus) => units.filter((unit) => unit.status === status).length;
  const rentableUnits = units.filter((unit) => RENTABLE_UNIT_STATUSES.includes(unit.status)).length;
  const occupiedUnits = units.filter((unit) => OCCUPIED_UNIT_STATUSES.includes(unit.status)).length;

  return {
    totalUnits: units.length,
    rentableUnits,
    occupiedUnits,
    noticeUnits: countOf("notice"),
    vacantReadyUnits: countOf("vacant_ready"),
    vacantNotReadyUnits: countOf("vacant_not_ready"),
    downUnits: countOf("down"),
    physicalOccupancyPct: percentOf(occupiedUnits, rentableUnits),
    availableToLeaseUnits: countOf("vacant_ready"),
  };
}

export interface VacancyDurationSummary {
  /** Vacant units whose `vacantSince` is known — the denominator every figure below is over. */
  measuredUnits: number;
  /** Vacant units with no `vacantSince`, excluded rather than assumed to have just turned. */
  unmeasuredUnits: number;
  averageDaysVacant: number | null;
  longestDaysVacant: number | null;
  /** Units vacant beyond `thresholdDays`, the ones worth acting on. */
  overThresholdUnitIds: string[];
}

/**
 * How long vacant units have been vacant.
 *
 * Units missing `vacantSince` are counted in `unmeasuredUnits` and left out of
 * the averages instead of being treated as freshly vacant. A source that
 * doesn't publish the date should shrink the sample and say so, not pull the
 * average down toward zero and make a turnover problem disappear.
 */
export function summarizeVacancyDuration(units: UnitLike[], asOf: Date, thresholdDays = VACANCY_THRESHOLD_DAYS): VacancyDurationSummary {
  const vacant = units.filter((unit) => unit.status === "vacant_ready" || unit.status === "vacant_not_ready");
  const measured = vacant.filter((unit) => unit.vacantSince !== null);
  const durations = measured.map((unit) => daysBetween(unit.vacantSince as Date, asOf));

  return {
    measuredUnits: measured.length,
    unmeasuredUnits: vacant.length - measured.length,
    averageDaysVacant: durations.length > 0 ? round(average(durations) as number, 1) : null,
    longestDaysVacant: durations.length > 0 ? Math.max(...durations) : null,
    overThresholdUnitIds: measured
      .filter((unit) => daysBetween(unit.vacantSince as Date, asOf) > thresholdDays)
      .map((unit) => unit.id),
  };
}

export interface RentPositionSummary {
  /** Sum of market rent across every rentable unit that has one — what the portfolio would bill at full occupancy and asking rent. */
  grossPotentialRentCents: number;
  /** Rentable units with no market rent on file, excluded from GPR rather than counted as zero. */
  unitsMissingMarketRent: number;
  /** Contract rent on active leases. */
  inPlaceRentCents: number;
  /**
   * Market rent minus contract rent across occupied units that have both.
   * Positive means units are leased below asking — money left on the table at
   * renewal. Negative means in-place rents are above current asking, which is
   * a signal about the market, not an error.
   */
  lossToLeaseCents: number | null;
  /** Occupied units where both figures are present — the sample loss-to-lease was measured over. */
  lossToLeaseUnitCount: number;
  /**
   * Vacant rentable units' market rent: revenue the portfolio is not earning
   * because the unit is empty, as distinct from loss-to-lease on units that
   * are earning something.
   */
  vacancyLossCents: number;
}

export function summarizeRentPosition(units: UnitLike[], activeLeases: ActiveLeaseLike[]): RentPositionSummary {
  const rentByUnit = new Map(activeLeases.map((lease) => [lease.unitId, lease.rentCents]));
  const rentable = units.filter((unit) => RENTABLE_UNIT_STATUSES.includes(unit.status));

  const grossPotentialRentCents = rentable.reduce((total, unit) => total + (unit.marketRentCents ?? 0), 0);
  const unitsMissingMarketRent = rentable.filter((unit) => unit.marketRentCents === null).length;
  const inPlaceRentCents = activeLeases.reduce((total, lease) => total + lease.rentCents, 0);

  const comparable = rentable.filter(
    (unit) => OCCUPIED_UNIT_STATUSES.includes(unit.status) && unit.marketRentCents !== null && rentByUnit.has(unit.id),
  );
  const lossToLeaseCents = comparable.reduce(
    (total, unit) => total + ((unit.marketRentCents as number) - (rentByUnit.get(unit.id) as number)),
    0,
  );

  const vacancyLossCents = rentable
    .filter((unit) => !OCCUPIED_UNIT_STATUSES.includes(unit.status))
    .reduce((total, unit) => total + (unit.marketRentCents ?? 0), 0);

  return {
    grossPotentialRentCents,
    unitsMissingMarketRent,
    inPlaceRentCents,
    lossToLeaseCents: comparable.length > 0 ? lossToLeaseCents : null,
    lossToLeaseUnitCount: comparable.length,
    vacancyLossCents,
  };
}

/**
 * Economic occupancy: rent actually collected against gross potential rent.
 *
 * The number that separates a portfolio that is full from one that is
 * *earning*. Physical occupancy counts bodies; this counts dollars, so
 * concessions, delinquency and vacancy all show up in it — which is why the
 * 2026 multifamily benchmarks put it alongside, never instead of, physical
 * occupancy.
 *
 * Null when there is no gross potential rent to measure against, since a
 * portfolio with no market rents on file has no meaningful denominator.
 */
export function economicOccupancyPct(collectedRentCents: number, grossPotentialRentCents: number): number | null {
  return percentOf(collectedRentCents, grossPotentialRentCents);
}

export interface UnitMixRow {
  /** e.g. "2BR/1BA", or "Unspecified" for units with no bedroom/bathroom counts on file. */
  label: string;
  units: number;
  occupied: number;
  occupancyPct: number | null;
  averageMarketRentCents: number | null;
}

/** The label a unit's bedroom/bathroom counts produce, and the grouping key for unit-mix reporting. */
export function unitTypeLabel(unit: Pick<UnitLike, "bedrooms" | "bathrooms">): string {
  if (unit.bedrooms === null && unit.bathrooms === null) return "Unspecified";
  const beds = unit.bedrooms === null ? "?" : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms}BR`;
  const baths = unit.bathrooms === null ? "?" : `${unit.bathrooms}BA`;
  return `${beds}/${baths}`;
}

/**
 * Occupancy and asking rent per unit type.
 *
 * Worth breaking out because a portfolio-wide occupancy figure routinely hides
 * the actual problem: studios full and three-beds sitting averages to a
 * healthy-looking number that tells a leasing team nothing about where to put
 * its concessions.
 */
export function summarizeUnitMix(units: UnitLike[]): UnitMixRow[] {
  const groups = new Map<string, UnitLike[]>();
  for (const unit of units) {
    const label = unitTypeLabel(unit);
    const group = groups.get(label);
    if (group) group.push(unit);
    else groups.set(label, [unit]);
  }

  return [...groups.entries()]
    .map(([label, group]) => {
      const rentable = group.filter((unit) => RENTABLE_UNIT_STATUSES.includes(unit.status));
      const occupied = group.filter((unit) => OCCUPIED_UNIT_STATUSES.includes(unit.status)).length;
      const rents = group.map((unit) => unit.marketRentCents).filter((rent): rent is number => rent !== null);
      return {
        label,
        units: group.length,
        occupied,
        occupancyPct: percentOf(occupied, rentable.length),
        averageMarketRentCents: rents.length > 0 ? Math.round(average(rents) as number) : null,
      };
    })
    .sort((a, b) => b.units - a.units);
}
