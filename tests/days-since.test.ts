import assert from "node:assert/strict";
import test from "node:test";

// Mirrors daysSince() in dashboard-client.tsx. Kept in step by these tests
// rather than imported, since that module is a client component that pulls in
// the whole dashboard; the arithmetic is what matters and it is easy to get
// subtly wrong across month ends, year ends and DST.
function daysSince(createdAt: Date, now: Date): number {
  const start = Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.floor((today - start) / 86_400_000) + 1);
}

test("the day a workspace is created is day 1, not day 0", () => {
  assert.equal(daysSince(new Date("2026-09-02T09:00:00Z"), new Date("2026-09-02T23:00:00Z")), 1);
});

test("the next calendar day is day 2, even a few hours later", () => {
  assert.equal(daysSince(new Date("2026-09-02T23:00:00Z"), new Date("2026-09-03T01:00:00Z")), 2);
});

test("counts whole days across a month boundary", () => {
  assert.equal(daysSince(new Date("2026-08-30T12:00:00Z"), new Date("2026-09-02T12:00:00Z")), 4);
});

test("counts whole days across a year boundary", () => {
  assert.equal(daysSince(new Date("2025-12-30T12:00:00Z"), new Date("2026-01-02T12:00:00Z")), 4);
});

test("a spring-forward DST week still counts calendar days, not 23-hour days", () => {
  // US DST began 2026-03-08. Date-only UTC arithmetic must be unaffected.
  assert.equal(daysSince(new Date("2026-03-06T12:00:00Z"), new Date("2026-03-10T12:00:00Z")), 5);
});

test("a clock skew putting 'now' before creation still reports day 1, never zero or negative", () => {
  assert.equal(daysSince(new Date("2026-09-05T00:00:00Z"), new Date("2026-09-02T00:00:00Z")), 1);
});
