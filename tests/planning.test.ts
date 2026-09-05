import assert from "node:assert/strict";
import test from "node:test";
import { parseItem, overlapsWindow } from "../lib/planning/types.ts";
const valid = {
  title: "Inspect roof",
  description: "After the rain",
  kind: "task",
  status: "planned",
  projectId: null,
  assigneeId: null,
  startsAt: 1000,
  endsAt: 2000,
};
test("planning refuses impossible dates and unrecognized fields that control workflow", () => {
  for (const patch of [
    { startsAt: NaN },
    { startsAt: Infinity },
    { startsAt: -1 },
    { endsAt: 500 },
    { endsAt: 7258118400001 },
    { status: "approved" },
    { kind: "payment" },
    { title: " " },
    { title: "a".repeat(161) },
    { description: "a".repeat(5001) },
    { projectId: {} },
    { assigneeId: 5 },
  ])
    assert.equal(parseItem({ ...valid, ...patch }), null);
  assert.deepEqual(
    parseItem({ ...valid, title: " Inspect roof ", organizationId: "other" }),
    valid,
  );
});
test("calendar overlap includes multi-day work and zero-duration events at a boundary", () => {
  assert.equal(overlapsWindow({ startsAt: 10, endsAt: 30 }, 20, 25), true);
  assert.equal(overlapsWindow({ startsAt: 20, endsAt: 20 }, 20, 20), true);
  assert.equal(overlapsWindow({ startsAt: 10, endsAt: 19 }, 20, 30), false);
  assert.equal(overlapsWindow({ startsAt: 31, endsAt: 40 }, 20, 30), false);
});
