import assert from "node:assert/strict";
import test from "node:test";
import { planMerge } from "../lib/operations/merge.ts";

/**
 * The three merge rules are the load-bearing behavior of connecting a
 * portfolio's whole stack: they decide when a second system's data is written,
 * when it is flagged, and when it is ignored. Getting any of them wrong
 * produces a dashboard that is confidently wrong with nothing on screen to
 * say so, which is the failure this whole mechanism exists to prevent.
 */

// A type alias, not an interface: `planMerge` takes `Record<string, unknown>`,
// and only aliases get the implicit index signature that satisfies it. The
// Drizzle row types real callers pass are aliases too, so this matches them.
type StoredUnit = {
  name: string;
  // Nullable in the schema, so the merge rules have to be exercised against
  // both a present and an absent value.
  marketRentCents: number | null;
  squareFeet: number | null;
  status: string;
};

const STORED: StoredUnit = {
  name: "Maple Court",
  marketRentCents: 200_000,
  squareFeet: null,
  status: "active",
};
const FIELDS = ["name", "marketRentCents", "squareFeet", "status"] as const;

test("rule 1: a source owns its own rows — a re-sync updates and flags nothing", () => {
  const plan = planMerge(STORED, "appfolio", { marketRentCents: 215_000 }, "appfolio", FIELDS);
  assert.deepEqual(plan.updates, { marketRentCents: 215_000 });
  assert.deepEqual(plan.conflicts, []);
});

test("rule 2: a second source filling a null is new information, not a disagreement", () => {
  const plan = planMerge(STORED, "appfolio", { squareFeet: 850 }, "quickbooks", FIELDS);
  assert.deepEqual(plan.updates, { squareFeet: 850 });
  assert.deepEqual(plan.conflicts, []);
});

test("rule 3: two sources with two values keeps the stored one and records the clash", () => {
  const plan = planMerge(STORED, "appfolio", { marketRentCents: 189_000 }, "quickbooks", FIELDS);
  // The stored value is untouched. Nothing on the dashboard silently changes.
  assert.deepEqual(plan.updates, {});
  assert.equal(plan.conflicts.length, 1);
  assert.deepEqual(plan.conflicts[0], {
    field: "marketRentCents",
    storedValue: "200000",
    storedSource: "appfolio",
    incomingValue: "189000",
    incomingSource: "quickbooks",
  });
});

test("an unreported field is untouched — undefined means 'this source didn't say'", () => {
  const plan = planMerge(STORED, "appfolio", { marketRentCents: undefined }, "quickbooks", FIELDS);
  assert.deepEqual(plan.updates, {});
  assert.deepEqual(plan.conflicts, []);
});

test("a secondary source reporting null cannot clear a value it doesn't have", () => {
  const plan = planMerge(STORED, "appfolio", { marketRentCents: null }, "quickbooks", FIELDS);
  assert.deepEqual(plan.updates, {});
  // Nor is a blank treated as a disagreement worth a person's time.
  assert.deepEqual(plan.conflicts, []);
});

test("the owning source may clear its own value", () => {
  const plan = planMerge(STORED, "appfolio", { marketRentCents: null }, "appfolio", FIELDS);
  assert.deepEqual(plan.updates, { marketRentCents: null });
});

test("only listed fields are considered, so a new column can't silently become syncable", () => {
  const stored = { ...STORED, internalNote: "do not sync" };
  const plan = planMerge(stored, "appfolio", { internalNote: "overwritten" } as Partial<typeof stored>, "appfolio", FIELDS);
  assert.deepEqual(plan.updates, {});
});

test("equal values produce nothing at all", () => {
  const plan = planMerge(STORED, "appfolio", { name: "Maple Court", marketRentCents: 200_000 }, "quickbooks", FIELDS);
  assert.deepEqual(plan.updates, {});
  assert.deepEqual(plan.conflicts, []);
});

test("dates compare by instant, so a re-parsed timestamp is not a conflict", () => {
  const stored = { vacantSince: new Date("2026-08-01T00:00:00Z") };
  const fields = ["vacantSince"] as const;

  const same = planMerge(stored, "appfolio", { vacantSince: new Date("2026-08-01T00:00:00Z") }, "buildium", fields);
  assert.deepEqual(same.conflicts, []);
  assert.deepEqual(same.updates, {});

  const different = planMerge(stored, "appfolio", { vacantSince: new Date("2026-08-09T00:00:00Z") }, "buildium", fields);
  assert.equal(different.conflicts.length, 1);
  // Recorded as ISO, so a conflict is readable without knowing the column type.
  assert.equal(different.conflicts[0].storedValue, "2026-08-01T00:00:00.000Z");
  assert.equal(different.conflicts[0].incomingValue, "2026-08-09T00:00:00.000Z");
});

test("several contested fields each produce their own conflict", () => {
  const plan = planMerge(
    STORED,
    "appfolio",
    { name: "Maple Ct.", marketRentCents: 189_000, status: "inactive" },
    "buildium",
    FIELDS,
  );
  assert.deepEqual(
    plan.conflicts.map((conflict) => conflict.field).sort(),
    ["marketRentCents", "name", "status"],
  );
  assert.deepEqual(plan.updates, {});
});
