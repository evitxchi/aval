import assert from "node:assert/strict";
import test from "node:test";
import { estimatedPipeSizeInches, totalFixtureUnits } from "../lib/infrastructure/plumbing.ts";

test("totalFixtureUnits sums fixture-unit values across fixture counts", () => {
  const total = totalFixtureUnits([
    { type: "waterCloset", count: 2 }, // 2.2 * 2 = 4.4
    { type: "lavatory", count: 2 }, // 1 * 2 = 2
    { type: "bathtub", count: 1 }, // 2
  ]);
  assert.equal(total, 8.4);
});

test("totalFixtureUnits rejects a negative count", () => {
  assert.throws(() => totalFixtureUnits([{ type: "lavatory", count: -1 }]), /negative count/);
});

test("estimatedPipeSizeInches picks the smallest band that covers the load", () => {
  assert.equal(estimatedPipeSizeInches(5), 0.75);
  assert.equal(estimatedPipeSizeInches(6), 0.75);
  assert.equal(estimatedPipeSizeInches(6.1), 1);
  assert.equal(estimatedPipeSizeInches(500), 3);
});
