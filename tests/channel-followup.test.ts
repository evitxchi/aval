import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  historyFrom,
  intervalFor,
} from "../lib/channels/follow-up.ts";
import { stateFor, mayCallModel, bodyCapFor, modelOverrideFor } from "../lib/channels/budget.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// A fixed reminder interval is wrong in both directions: nagging for someone
// who always replies in an hour, far too slow for someone who reliably takes
// three days.

test("with no history at all, the default interval applies", () => {
  assert.equal(intervalFor({ latencies: [], unanswered: 0 }), DEFAULT_INTERVAL_MS);
});

test("a fast replier is chased sooner, but never inside the floor", () => {
  const fast = intervalFor({ latencies: [HOUR, 2 * HOUR, HOUR], unanswered: 0 });
  assert.equal(fast, MIN_INTERVAL_MS, "1.5x a two-hour median is under the floor, so the floor wins");
  assert.ok(fast < DEFAULT_INTERVAL_MS);
});

test("a slow replier is given longer", () => {
  const slow = intervalFor({ latencies: [4 * DAY, 5 * DAY, 4 * DAY], unanswered: 0 });
  assert.ok(slow > DEFAULT_INTERVAL_MS, "someone who reliably takes four days should not be chased on day three");
  assert.equal(slow, 6 * DAY);
});

test("the ceiling holds however slow the contact is", () => {
  assert.equal(intervalFor({ latencies: [60 * DAY], unanswered: 0 }), MAX_INTERVAL_MS, "a balance does not wait a month");
});

test("the median is used, so one holiday does not skew the interval", () => {
  // The failure this prevents: a mean dragged up by a single fortnight's
  // absence stops us ever following up with a same-day replier.
  const withOutlier = intervalFor({ latencies: [HOUR, 2 * HOUR, 3 * HOUR, 30 * DAY], unanswered: 0 });
  const withoutOutlier = intervalFor({ latencies: [HOUR, 2 * HOUR, 3 * HOUR], unanswered: 0 });
  assert.equal(withOutlier, withoutOutlier, "one outlier must not change the answer");
});

test("an even number of latencies averages the middle two", () => {
  // 2 and 4 days → median 3 days → 1.5x → 4.5 days.
  assert.equal(intervalFor({ latencies: [2 * DAY, 4 * DAY], unanswered: 0 }), 4.5 * DAY);
});

test("latency is measured from the first message of a run, not the last", () => {
  // Counting from the last would measure how long someone took after being
  // chased twice, which is a fact about our nagging rather than about them.
  const history = historyFrom([
    { direction: "outbound", createdAt: new Date(0) },
    { direction: "outbound", createdAt: new Date(2 * DAY) },
    { direction: "inbound", createdAt: new Date(3 * DAY) },
  ]);
  assert.deepEqual(history.latencies, [3 * DAY]);
});

test("a thread ending on an outbound message is an outstanding question", () => {
  const history = historyFrom([
    { direction: "inbound", createdAt: new Date(0) },
    { direction: "outbound", createdAt: new Date(DAY) },
  ]);
  assert.equal(history.unanswered, 1);
  assert.deepEqual(history.latencies, []);
});

test("a thread ending on an inbound message has nothing outstanding", () => {
  const history = historyFrom([
    { direction: "outbound", createdAt: new Date(0) },
    { direction: "inbound", createdAt: new Date(DAY) },
  ]);
  assert.equal(history.unanswered, 0);
  assert.deepEqual(history.latencies, [DAY]);
});

test("an empty thread produces no history and no crash", () => {
  assert.deepEqual(historyFrom([]), { latencies: [], unanswered: 0 });
});

// The spend ceiling. Silently exceeding budget and silently going dark are
// both worse than a visible downgrade.

test("a fresh workspace is at the normal tier", () => {
  const state = stateFor(0, 400);
  assert.equal(state.tier, "normal");
  assert.equal(state.degraded, false);
  assert.equal(mayCallModel(state.tier), true);
});

test("degradation starts before exhaustion, not at it", () => {
  // A ceiling that does nothing until it is hit gives the operator no warning
  // and no chance to raise it.
  assert.equal(stateFor(280, 400).tier, "reduced", "70% should already be degrading");
  assert.equal(stateFor(399, 400).tier, "templated");
  assert.equal(stateFor(400, 400).tier, "blocked");
  assert.equal(stateFor(10_000, 400).tier, "blocked");
});

test("the reduced tier still answers, the templated tier does not call a model", () => {
  assert.equal(mayCallModel("reduced"), true);
  assert.equal(mayCallModel("templated"), false, "a templated tier still serves gates and fixed replies");
  assert.equal(mayCallModel("blocked"), false);
});

test("a reduced answer is genuinely shorter and routes to a cheaper model", () => {
  // The degradation must be real rather than cosmetic: fewer output tokens.
  assert.ok(bodyCapFor("reduced") < bodyCapFor("normal"));
  assert.equal(modelOverrideFor("reduced"), "claude-haiku-4-5-20251001");
  assert.equal(modelOverrideFor("normal"), null, "no override at the normal tier — the org's own choice stands");
});

test("a zero or nonsense cap fails closed rather than granting infinite budget", () => {
  assert.equal(stateFor(0, 0).tier, "blocked");
});
