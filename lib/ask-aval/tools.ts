/**
 * Tools available to Ask Aval.
 *
 * Design rule: the model selects tools and arguments. It never computes a
 * number itself — every figure in its final answer must trace back to a
 * tool result (enforced by the faithfulness gate in handler.ts).
 *
 * This app runs on a single static sample-data snapshot (app/data/sample.ts),
 * not a live per-tenant database yet, so every executor below reads that
 * snapshot rather than querying tables that don't exist. Anywhere the
 * snapshot genuinely doesn't have what a tool's shape implies (a numeric
 * days-past-due figure, a real dollar-scale time series for NOI), the
 * executor says so in a `note` field instead of inventing a plausible value.
 */

import type { ToolSchema } from "./anthropic";
import { derivedSample, sampleData, sumAmounts, type InsightRecipient } from "@/app/data/sample";

/** Every numeric value a tool exposed, collected for the faithfulness gate. */
export interface ToolOutput {
  json: unknown;
  numbers: number[];
}

// sampleData's property/revenue rows carry i18n message keys (e.g.
// "OperationsView.propertyFranklinHouse"), not display text — the message
// catalog lives client-side. These give the model plain English names to
// reason and write about; the model is separately instructed to answer in
// the user's own locale regardless of what language these labels are in.
const PROPERTY_NAMES: Record<string, string> = {
  "OperationsView.propertyFranklinHouse": "Franklin House",
  "OperationsView.propertyMonroeCourt": "Monroe Court",
  "OperationsView.propertyUnionCourt": "Union Court",
  "OperationsView.propertyRomaSur": "Roma Sur",
  "OperationsView.propertyPaseoNorte": "Paseo Norte",
  "OperationsView.propertyJardines22": "Jardines 22",
};

/* ── schemas the model sees ─────────────────────────────────────────────── */

export const TOOLS: ToolSchema[] = [
  {
    name: "get_portfolio_metrics",
    description:
      "Portfolio-level figures: NOI, rent billed/collected, collection rate, economic occupancy, " +
      "open work orders. Use for any question about overall financial or operational performance.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["current_week", "prior_week", "month_to_date", "prior_month"], description: "Informational only — this sample snapshot is a single fixed point in time, not a per-period series." },
        property_id: { type: "string", description: "Optional. Sample mode has no property-level breakdown of these figures — omit, or expect a note saying so." },
      },
    },
  },
  {
    name: "get_property_breakdown",
    description: "Per-property unit counts, occupancy, and units ready to lease. Use for property-level occupancy questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_delinquent_accounts",
    description: "Reachable residents with an outstanding balance: name, balance, and messaging channel. Use for collections questions.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 20, max 50." } },
    },
  },
  {
    name: "get_leasing_funnel",
    description: "Lead-to-lease funnel counts and stage conversion for a week, plus the six-week trend behind it.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["current_week", "prior_week"], description: "Only these two map to real distinct weeks in sample mode." } },
    },
  },
  {
    name: "get_metric_series",
    description:
      "A real, correctly-scaled time series for charting. Only metrics with genuine multi-point sample data are supported: " +
      "contacted, viewed, applied, signed (six weekly points each), and maintenance_requests (four monthly points). " +
      "Do not ask for NOI, rent, or occupancy series — sample mode has only single-point snapshots for those, not a real series.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["contacted", "viewed", "applied", "signed", "maintenance_requests"] },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_accounting_breakdown",
    description: "Revenue sources, expense categories, and NOI margin for the current period. Use for cost, margin, or budget questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "render_answer",
    description:
      "Call this exactly once, last, to return the final answer. Do not write prose outside this tool. " +
      "Every number in `narrative` or `document` must have appeared in a previous tool result.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "Under 90 characters." },
        narrative: {
          type: "string",
          description:
            "Two to four sentences stating the finding and, if knowable from the data, the cause. No greeting, no sign-off. " +
            "If a cause is inferred rather than computed, hedge it explicitly.",
        },
        document: { type: "string", description: "Optional. A full markdown proposal, memo, or written analysis when the question calls for one rather than a quick answer. Omit for simple questions." },
        metrics: {
          type: "array",
          description: "Up to 4 figures to display as tiles. Values must come from tool results.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
              unit: { type: "string", enum: ["currency", "percent", "count", "days"] },
              delta: { type: "number", description: "Optional. Point or percent change, if a prior value is available." },
            },
            required: ["label", "value", "unit"],
          },
        },
        chart: {
          type: "object",
          description: "Optional. Only from get_metric_series output — never hand-built.",
          properties: {
            metric: { type: "string" },
            title: { type: "string" },
            points: {
              type: "array",
              items: { type: "object", properties: { x: { type: "string" }, y: { type: "number" } }, required: ["x", "y"] },
            },
          },
        },
        evidence_ids: {
          type: "array",
          description: "Row identifiers from tool results that back the claim (e.g. resident:Lucía R.).",
          items: { type: "string" },
        },
        action: { type: "string", description: "Optional. A short label (2-5 words) for one concrete next action the user could take." },
        actionDetail: { type: "string", description: "Optional. One sentence describing what approving that action would actually do." },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["headline", "narrative", "confidence"],
    },
  },
];

/* ── executors ──────────────────────────────────────────────────────────── */

function collectNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectNumbers(x, out));
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
  switch (name) {
    case "get_portfolio_metrics": {
      const propertyId = typeof input.property_id === "string" ? input.property_id : null;
      const json = {
        noi: sampleData.noi.value,
        noi_prior: sampleData.noi.priorValue,
        noi_delta_pct: round2(derivedSample.noiDeltaPct),
        rent_billed: sampleData.rentCollected.billed,
        rent_collected: sampleData.rentCollected.value,
        collection_rate_pct: round2(derivedSample.rentCollectedPct),
        economic_occupancy_pct: sampleData.economicOccupancy.value,
        economic_occupancy_prior_pct: sampleData.economicOccupancy.priorValue,
        open_work_orders: sampleData.openWorkOrders.value,
        urgent_work_orders: sampleData.openWorkOrders.urgent,
        avg_work_order_close_days: sampleData.openWorkOrders.avgCloseDays,
        total_units: sampleData.portfolio.units,
        total_properties: sampleData.portfolio.properties,
        note: propertyId
          ? "Sample mode has one fixed portfolio-wide snapshot, not a per-property breakdown of these figures — use get_property_breakdown for property-level occupancy instead."
          : "Sample mode: one fixed snapshot, not a live per-period feed. These are that snapshot's real figures.",
      };
      return { json, numbers: collectNumbers(json) };
    }

    case "get_property_breakdown": {
      const rows = sampleData.properties.list.map((row) => ({
        property: PROPERTY_NAMES[row.nameKey] ?? row.nameKey,
        units: row.units,
        occupied: row.occupied,
        occupied_pct: round2((row.occupied / row.units) * 100),
        ready_for_leasing: row.readyForLeasing,
      }));
      const json = { properties: rows };
      return { json, numbers: collectNumbers(json) };
    }

    case "get_delinquent_accounts": {
      const limit = clamp(Number(input.limit ?? 20), 1, 50);
      const collectionsInsight = sampleData.insights.candidates.find((candidate) => candidate.id === "collections-gap");
      const recipients: InsightRecipient[] = collectionsInsight?.action?.type === "sendReminders" ? collectionsInsight.action.recipients : [];
      const rows = recipients.slice(0, limit).map((recipient) => ({
        id: `resident:${recipient.name}`,
        resident: recipient.name,
        balance: recipient.amount,
        channel: recipient.channel,
      }));
      const json = {
        count: rows.length,
        total_balance: sumAmounts(recipients.map((recipient) => ({ amount: recipient.amount }))),
        rows,
        note: "Sample mode tracks these reachable delinquent accounts with real balances, but does not track a numeric days-past-due field for them — do not state a specific day count for any of these.",
      };
      return { json, numbers: collectNumbers(json) };
    }

    case "get_leasing_funnel": {
      const period = input.period === "prior_week" ? "prior_week" : "current_week";
      const trend = sampleData.leasing.trend;
      const snapshot = period === "prior_week" && trend.length > 1 ? trend[trend.length - 2] : trend[trend.length - 1];
      const json = {
        period,
        contacted: snapshot.contacted,
        viewed: snapshot.viewed,
        applied: snapshot.applied,
        signed: snapshot.signed,
        contacted_to_viewed_pct: round2((snapshot.viewed / snapshot.contacted) * 100),
        contacted_to_signed_pct: round2((snapshot.signed / snapshot.contacted) * 100),
        six_week_trend: trend.map((week) => ({ contacted: week.contacted, viewed: week.viewed, applied: week.applied, signed: week.signed })),
      };
      return { json, numbers: collectNumbers(json) };
    }

    case "get_metric_series": {
      const metric = String(input.metric ?? "");
      const leasingKeys = ["contacted", "viewed", "applied", "signed"] as const;
      if ((leasingKeys as readonly string[]).includes(metric)) {
        const key = metric as (typeof leasingKeys)[number];
        const points = sampleData.leasing.trend.map((week) => ({ x: week.labelKey, y: week[key] }));
        const json = { metric, grain: "week", points };
        return { json, numbers: collectNumbers(json) };
      }
      if (metric === "maintenance_requests") {
        const points = sampleData.maintenance.months.map((month, index) => ({
          x: `${month.year}-${String(month.month).padStart(2, "0")}`,
          y: sampleData.maintenance.categories.reduce((sum, category) => sum + category.countsByMonth[index], 0),
        }));
        const json = { metric, grain: "month", points };
        return { json, numbers: collectNumbers(json) };
      }
      return { json: { error: `No real time series is tracked for "${metric}" in sample mode. Available series: contacted, viewed, applied, signed, maintenance_requests.` }, numbers: [] };
    }

    case "get_accounting_breakdown": {
      const revenueSources = sampleData.accounting.revenueSources.map((source) => ({ category: source.key, amount: source.amount }));
      const expenses = sampleData.accounting.expenses.map((expense) => ({ category: expense.key, amount: expense.amount }));
      const totalRevenue = sumAmounts(sampleData.accounting.revenueSources);
      const totalExpenses = sumAmounts(sampleData.accounting.expenses);
      const json = {
        revenue_sources: revenueSources,
        expenses,
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        noi: sampleData.noi.value,
        noi_margin_pct: round2((sampleData.noi.value / totalRevenue) * 100),
      };
      return { json, numbers: collectNumbers(json) };
    }

    default:
      return { json: { error: `Unknown tool "${name}".` }, numbers: [] };
  }
}
