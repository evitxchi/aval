import assert from "node:assert/strict";
import test from "node:test";
import { chartDomain } from "../lib/charts/domain.ts";

test("chart scales include the zero baseline for positive, negative and mixed values", () => {
  for (const values of [
    [0],
    [8, 29],
    [-23, -4],
    [-18, 115],
    [0.13, 0.41],
    [null, NaN, Infinity].filter((n): n is number => typeof n === "number"),
  ]) {
    const { bottom, top, ticks } = chartDomain(values);
    assert.ok(top > bottom);
    assert.ok(ticks.includes(0));
    for (const value of values.filter(Number.isFinite))
      assert.ok(value >= bottom && value <= top);
    assert.ok(ticks.length >= 2 && ticks.length <= 8);
  }
});

test("counts have whole-number ticks and missing observations have a safe scale", () => {
  assert.ok(chartDomain([1, 2, 3]).ticks.every(Number.isInteger));
  assert.deepEqual(chartDomain([]), { bottom: 0, top: 1, ticks: [0, 1] });
});
