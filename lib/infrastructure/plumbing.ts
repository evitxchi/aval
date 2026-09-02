/**
 * Water-supply fixture-unit (WSFU) estimation for the "plumbing / other
 * infrastructure" corner of this module.
 *
 * A GitHub sourcing pass found no credible open-source library here (the
 * one repo that came up was a Revit/Dynamo script, not a package) — the
 * underlying fixture-unit tables and Hunter's-curve-derived pipe-sizing
 * bands are static numbers published across US plumbing codes (IPC/UPC),
 * cheaper to hand-encode than to depend on anything. The values below are
 * the figures most commonly cited across those codes for quick estimation.
 *
 * This is a planning estimate, not a code-compliance tool: real pipe
 * sizing must use the actual code adopted by the local authority having
 * jurisdiction, which varies by fixture flow pressure, pipe material, and
 * run length that this function does not model.
 */

export type FixtureType =
  | "lavatory"
  | "waterCloset" // tank type
  | "waterClosetFlushometer"
  | "bathtub"
  | "shower"
  | "kitchenSink"
  | "dishwasher"
  | "clothesWasher"
  | "hoseBib"
  | "urinal";

/** Commonly published WSFU (water supply fixture units) per fixture, cold+hot combined, private/residential use. */
export const FIXTURE_UNIT_TABLE: Record<FixtureType, number> = {
  lavatory: 1,
  waterCloset: 2.2,
  waterClosetFlushometer: 5,
  bathtub: 2,
  shower: 2,
  kitchenSink: 1.5,
  dishwasher: 1.4,
  clothesWasher: 4,
  hoseBib: 2.5,
  urinal: 3,
};

export interface FixtureCount {
  type: FixtureType;
  count: number;
}

export function totalFixtureUnits(fixtures: FixtureCount[]): number {
  return fixtures.reduce((total, fixture) => {
    if (fixture.count < 0) throw new Error(`totalFixtureUnits: negative count for ${fixture.type}`);
    return total + FIXTURE_UNIT_TABLE[fixture.type] * fixture.count;
  }, 0);
}

/** Ascending (fixtureUnitsUpTo, nominalPipeSizeInches) bands, conventional estimates for a typical residential/light-commercial supply run. */
const PIPE_SIZE_BANDS: [maxFixtureUnits: number, nominalInches: number][] = [
  [6, 0.75],
  [16, 1],
  [30, 1.25],
  [60, 1.5],
  [120, 2],
  [270, 2.5],
  [450, 3],
];

/** Rough nominal supply pipe size for a given total fixture-unit load. Returns the largest band's size if the load exceeds all bands — flag that case for real engineering review rather than trusting this estimate. */
export function estimatedPipeSizeInches(fixtureUnits: number): number {
  if (fixtureUnits < 0) throw new Error("estimatedPipeSizeInches: fixtureUnits must be non-negative");
  const band = PIPE_SIZE_BANDS.find(([max]) => fixtureUnits <= max);
  return band ? band[1] : PIPE_SIZE_BANDS.at(-1)![1];
}
