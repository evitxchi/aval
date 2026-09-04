import assert from "node:assert/strict";
import test from "node:test";
import {
  economicOccupancyPct,
  summarizeOccupancy,
  summarizeRentPosition,
  summarizeUnitMix,
  summarizeVacancyDuration,
  unitTypeLabel,
  type UnitLike,
} from "../lib/operations/metrics/occupancy.ts";
import { MS_PER_DAY, type UnitStatus } from "../lib/operations/types.ts";

const ASOF = new Date("2026-09-03T00:00:00Z");

function unit(id: string, status: UnitStatus, overrides: Partial<UnitLike> = {}): UnitLike {
  return {
    id,
    propertyId: "p1",
    status,
    marketRentCents: 200_000,
    bedrooms: 2,
    bathrooms: 1,
    vacantSince: null,
    ...overrides,
  };
}

test("physical occupancy counts notice units as occupied — the resident is still paying", () => {
  const summary = summarizeOccupancy([unit("a", "occupied"), unit("b", "notice"), unit("c", "vacant_ready")]);
  assert.equal(summary.occupiedUnits, 2);
  assert.equal(summary.noticeUnits, 1);
  assert.equal(summary.physicalOccupancyPct, 66.67);
  // ...but a unit on notice is not available to a prospect today.
  assert.equal(summary.availableToLeaseUnits, 1);
});

test("down units are excluded from occupancy rather than counted as vacant", () => {
  const withDown = summarizeOccupancy([unit("a", "occupied"), unit("b", "down")]);
  assert.equal(withDown.rentableUnits, 1);
  assert.equal(withDown.downUnits, 1);
  // 1 occupied of 1 rentable, not 1 of 2 — a unit out of service is not
  // inventory the leasing team failed to fill.
  assert.equal(withDown.physicalOccupancyPct, 100);
});

test("occupancy is null, not zero, for a portfolio with no rentable units", () => {
  assert.equal(summarizeOccupancy([]).physicalOccupancyPct, null);
  assert.equal(summarizeOccupancy([unit("a", "down")]).physicalOccupancyPct, null);
});

test("vacancy duration excludes units with no vacantSince instead of treating them as fresh", () => {
  const summary = summarizeVacancyDuration(
    [
      unit("a", "vacant_ready", { vacantSince: new Date(ASOF.getTime() - 10 * MS_PER_DAY) }),
      unit("b", "vacant_ready", { vacantSince: new Date(ASOF.getTime() - 50 * MS_PER_DAY) }),
      unit("c", "vacant_not_ready", { vacantSince: null }),
    ],
    ASOF,
  );
  assert.equal(summary.measuredUnits, 2);
  assert.equal(summary.unmeasuredUnits, 1);
  // The average is over the two known dates. Had the third been assumed to be
  // 0 days, this would read 20 and hide a 50-day vacancy.
  assert.equal(summary.averageDaysVacant, 30);
  assert.equal(summary.longestDaysVacant, 50);
  assert.deepEqual(summary.overThresholdUnitIds, ["b"]);
});

test("loss to lease measures market against contract rent on occupied units only", () => {
  const position = summarizeRentPosition(
    [
      unit("a", "occupied", { marketRentCents: 220_000 }),
      unit("b", "vacant_ready", { marketRentCents: 210_000 }),
    ],
    [{ unitId: "a", rentCents: 200_000 }],
  );
  assert.equal(position.lossToLeaseCents, 20_000);
  assert.equal(position.lossToLeaseUnitCount, 1);
  // The vacant unit's rent is vacancy loss, a different thing entirely.
  assert.equal(position.vacancyLossCents, 210_000);
  assert.equal(position.grossPotentialRentCents, 430_000);
});

test("loss to lease is null when no occupied unit has both figures", () => {
  const position = summarizeRentPosition([unit("a", "occupied", { marketRentCents: null })], [{ unitId: "a", rentCents: 200_000 }]);
  assert.equal(position.lossToLeaseCents, null);
  assert.equal(position.unitsMissingMarketRent, 1);
});

test("unit type labels handle studios and missing counts without inventing a type", () => {
  assert.equal(unitTypeLabel({ bedrooms: 2, bathrooms: 1 }), "2BR/1BA");
  assert.equal(unitTypeLabel({ bedrooms: 0, bathrooms: 1 }), "Studio/1BA");
  assert.equal(unitTypeLabel({ bedrooms: 1, bathrooms: 1.5 }), "1BR/1.5BA");
  assert.equal(unitTypeLabel({ bedrooms: null, bathrooms: null }), "Unspecified");
});

test("unit mix reports occupancy per type, which a portfolio average hides", () => {
  const mix = summarizeUnitMix([
    unit("a", "occupied", { bedrooms: 0, bathrooms: 1 }),
    unit("b", "occupied", { bedrooms: 0, bathrooms: 1 }),
    unit("c", "vacant_ready", { bedrooms: 3, bathrooms: 2 }),
    unit("d", "vacant_ready", { bedrooms: 3, bathrooms: 2 }),
  ]);
  const studios = mix.find((row) => row.label === "Studio/1BA");
  const threeBeds = mix.find((row) => row.label === "3BR/2BA");
  assert.equal(studios?.occupancyPct, 100);
  assert.equal(threeBeds?.occupancyPct, 0);
  // The portfolio-wide figure would be a healthy-looking 50%, describing
  // neither group.
});

test("economic occupancy is null without gross potential rent to measure against", () => {
  assert.equal(economicOccupancyPct(180_000, 200_000), 90);
  assert.equal(economicOccupancyPct(180_000, 0), null);
});
