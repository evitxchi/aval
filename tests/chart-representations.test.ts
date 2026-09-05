import assert from "node:assert/strict";
import test from "node:test";
import { chartKinds, segments, totals } from "../lib/charts/geometry.ts";
import { financialTimeline } from "../lib/charts/financial-timeline.ts";
import {
  profitAndLoss,
  type GlAccountLike,
  type GlTransactionLike,
} from "../lib/operations/metrics/financials.ts";
test("chart choices respect non-additive cohorts, signs, missing values, and temporal semantics", () => {
  const rows = [{ label: "A", values: { occupied: 8, vacant: 2 } }];
  assert.deepEqual(chartKinds(rows, ["occupied", "vacant"], false, true), [
    "bars",
    "horizontal",
    "dots",
    "stacked",
  ]);
  assert.ok(
    !chartKinds(rows, ["occupied", "vacant"], false, false).includes("stacked"),
  );
  for (const missing of [-1, null, NaN, Infinity])
    assert.ok(
      !chartKinds(
        [{ label: "A", values: { a: 4, b: missing } }],
        ["a", "b"],
        true,
        true,
      ).includes("stackedArea"),
    );
  assert.ok(
    chartKinds(rows, ["occupied", "vacant"], true, true).includes(
      "stackedArea",
    ),
  );
  assert.deepEqual(totals(rows, ["occupied", "vacant"]), [10]);
});
test("line and area paths preserve observation gaps", () => {
  assert.deepEqual(segments([0, null, 4, -3, NaN, undefined, 8]), [
    [{ index: 0, value: 0 }],
    [
      { index: 2, value: 4 },
      { index: 3, value: -3 },
    ],
    [{ index: 6, value: 8 }],
  ]);
});
const accounts: GlAccountLike[] = [
  {
    id: "rent",
    code: "4000",
    name: "Rent",
    accountType: "income",
    isTrustAccount: false,
  },
  {
    id: "fees",
    code: "4001",
    name: "Fees",
    accountType: "income",
    isTrustAccount: false,
  },
  {
    id: "repairs",
    code: "5000",
    name: "Repairs",
    accountType: "operating_expense",
    isTrustAccount: false,
  },
  {
    id: "roof",
    code: "6000",
    name: "Roof",
    accountType: "capital_expense",
    isTrustAccount: false,
  },
  {
    id: "deposit",
    code: "2000",
    name: "Trust",
    accountType: "income",
    isTrustAccount: true,
  },
];
const tx = (
  id: string,
  accountId: string,
  amountCents: number,
  time: string,
): GlTransactionLike => ({
  id,
  accountId,
  amountCents,
  postedAt: new Date(time),
  propertyId: "p1",
});
test("time buckets reconcile exactly to P&L, retain refunds, and exclude trust and capital from income/NOI", () => {
  const start = new Date("2026-08-01T12:00:00Z"),
    end = new Date("2026-08-03T12:00:00Z");
  const entries = [
    tx("0", "rent", 500, "2026-08-01T11:59:59Z"),
    tx("1", "rent", 150000, "2026-08-01T12:00:00Z"),
    tx("2", "fees", 4500, "2026-08-02T00:00:00Z"),
    tx("3", "repairs", 18000, "2026-08-02T23:59:59.999Z"),
    tx("4", "rent", -25000, "2026-08-03T12:00:00Z"),
    tx("5", "roof", 99000, "2026-08-02T15:00:00Z"),
    tx("6", "deposit", 200000, "2026-08-02T15:00:00Z"),
    tx("7", "rent", 90000, "2026-08-03T12:00:00.001Z"),
  ];
  const timeline = financialTimeline(entries, accounts, start, end)!;
  const pnl = profitAndLoss(entries, accounts, start, end);
  assert.equal(timeline.rows.length, 3);
  assert.equal(
    timeline.rows.reduce((n, r) => n + r.incomeCents, 0),
    pnl.incomeCents,
  );
  assert.equal(
    timeline.rows.reduce((n, r) => n + r.expenseCents, 0),
    pnl.operatingExpenseCents,
  );
  assert.equal(
    timeline.rows.reduce((n, r) => n + r.noiCents, 0),
    pnl.noiCents,
  );
  for (const r of timeline.rows)
    assert.equal(
      Object.values(r.income).reduce((a, b) => a + b, 0),
      r.incomeCents,
    );
  assert.equal(timeline.rows[2].incomeCents, -25000);
});
test("monthly buckets cover leap days and partial months without double counting", () => {
  const start = new Date("2024-01-31T00:00:00Z"),
    end = new Date("2024-03-31T23:59:59.999Z");
  const timeline = financialTimeline(
    [
      tx("1", "rent", 12, "2024-02-29T23:59:59.999Z"),
      tx("2", "rent", 8, "2024-03-01T00:00:00Z"),
    ],
    accounts,
    start,
    end,
  )!;
  assert.equal(timeline.granularity, "month");
  assert.deepEqual(
    timeline.rows.map((r) => r.incomeCents),
    [0, 12, 8],
  );
  assert.equal(financialTimeline([], accounts, start, end), null);
  assert.equal(financialTimeline([], [], end, start), null);
});
