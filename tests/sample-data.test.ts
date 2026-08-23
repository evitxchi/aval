import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSampleConsistency,
  deriveFunnelConversionPct,
  deriveRelativeDeltaPct,
  derivedSample,
  sampleData,
} from "../app/data/sample.ts";

test("assertSampleConsistency passes against the real sample data", () => {
  assert.doesNotThrow(() => assertSampleConsistency());
});

test("funnel conversion percentages match the published copy in the brief", () => {
  const contactedToViewed = deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "viewed");
  const contactedToSigned = deriveFunnelConversionPct(sampleData.funnel.stages, "contacted", "signed");
  assert.equal(contactedToViewed.toFixed(1), "55.4");
  assert.equal(contactedToSigned.toFixed(1), "14.2");
});

test("NOI and occupancy deltas match the published copy in the brief", () => {
  assert.equal(derivedSample.noiDeltaPct.toFixed(1), "4.8");
  assert.equal(derivedSample.occupancyDeltaPct.toFixed(1), "1.2");
});

test("assertSampleConsistency throws when a derived figure drifts from its inputs", () => {
  const original = derivedSample.noiDeltaPct;
  (derivedSample as { noiDeltaPct: number }).noiDeltaPct = original + 5;
  try {
    assert.throws(() => assertSampleConsistency(), /Sample data drift/);
  } finally {
    (derivedSample as { noiDeltaPct: number }).noiDeltaPct = original;
  }
});

test("funnel stage counts are monotonically decreasing", () => {
  assert.doesNotThrow(() => assertSampleConsistency());
  const counts = sampleData.funnel.stages.map((stage) => stage.count);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `stage ${i} (${counts[i]}) should not exceed stage ${i - 1} (${counts[i - 1]})`);
  }
});
