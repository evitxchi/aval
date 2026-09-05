"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Refresh } from "iconoir-react";
import type { OperationsOverview } from "@/lib/operations/summary";
import {
  sampleData,
  derivePropertyTotals,
  deriveMaintenanceReported,
  derivedSample,
} from "@/app/data/sample";
import { DataChart, type ChartRow, type ChartSeries } from "./data-chart";
import { useExperience } from "./experience";
type OperationsModule = "properties" | "leasing" | "maintenance" | "accounting";
export function OperationsWorkspace({
  view,
  sample,
  openConnections,
}: {
  view: OperationsModule;
  sample: boolean;
  openConnections: () => void;
}) {
  const t = useTranslations();
  const e = useTranslations("Enterprise");
  const locale = useLocale();
  const { market } = useExperience();
  const [period, setPeriod] = useState("month_to_date"),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState<{
      data: OperationsOverview | null;
      loading: boolean;
      error: boolean;
    }>({ data: null, loading: !sample, error: false });
  useEffect(() => {
    if (sample) return;
    const abort = new AbortController();
    void (async () => {
      setLoaded({ data: null, loading: true, error: false });
      try {
        const r = await fetch(`/api/operations/overview?period=${period}`, {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!r.ok) throw Error();
        const { overview } = (await r.json()) as {
          overview: OperationsOverview;
        };
        if (!abort.signal.aborted)
          setLoaded({ data: overview, loading: false, error: false });
      } catch {
        if (!abort.signal.aborted)
          setLoaded({ data: null, loading: false, error: true });
      }
    })();
    return () => abort.abort();
  }, [period, revision, sample]);
  const data = loaded.data;
  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: market === "latam" ? "MXN" : "USD",
      maximumFractionDigits: 2,
    }).format(n);
  const compactMoney = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: market === "latam" ? "MXN" : "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  const blue = "var(--viz-blue)",
    green = "var(--viz-green)",
    amber = "var(--viz-amber)";
  let rows: ChartRow[] = [],
    series: ChartSeries[] = [],
    metrics: {
      label: string;
      value: number | null;
      format?: (n: number) => string;
    }[] = [];
  let secondary: ChartRow[] = [],
    secondaryTitle = "";
  const titles = {
    properties: e("occupancyByType"),
    leasing: e("leasingFunnel"),
    maintenance: e("workByCategory"),
    accounting: e("incomeExpenses"),
  };
  if (view === "properties") {
    const p = derivePropertyTotals(sampleData.properties.list),
      o = data?.portfolio.occupancy;
    metrics = [
      {
        label: t("Nav.properties"),
        value: sample ? p.properties : (data?.portfolio.propertyCount ?? null),
      },
      { label: e("units"), value: sample ? p.units : (o?.totalUnits ?? null) },
      {
        label: e("occupied"),
        value: sample ? p.occupied : (o?.occupiedUnits ?? null),
      },
      {
        label: e("available"),
        value: sample ? p.readyForLeasing : (o?.availableToLeaseUnits ?? null),
      },
    ];
    series = [
      { key: "occupied", label: e("occupied"), color: blue },
      { key: "vacant", label: e("unoccupied"), color: "var(--viz-amber)" },
    ];
    rows = sample
      ? sampleData.properties.list.map((p) => ({
          label: t(p.nameKey),
          values: { occupied: p.occupied, vacant: p.units - p.occupied },
        }))
      : (data?.portfolio.unitMix ?? []).map((r) => ({
          label: r.label,
          values: { occupied: r.occupied, vacant: r.units - r.occupied },
        }));
  } else if (view === "leasing") {
    const stages = sample
      ? sampleData.funnel.stages.map((s) => ({
          label: t(s.labelKey),
          count: s.count,
        }))
      : (data?.leasing.funnel ?? []).map((s) => ({
          label: e(`stages.${s.stage}`),
          count: s.reached,
        }));
    rows = stages.map((s) => ({ label: s.label, values: { count: s.count } }));
    series = [{ key: "count", label: e("leads"), color: blue }];
    metrics = stages
      .slice(0, 4)
      .map((s) => ({ label: s.label, value: s.count }));
    secondaryTitle = e("leaseExpirations");
    secondary = (data?.leasing.expirations.schedule ?? []).map((s) => ({
      label: s.month,
      values: { count: s.leaseCount },
    }));
  } else if (view === "maintenance") {
    const m = data?.maintenance.summary;
    metrics = [
      {
        label: e("reported"),
        value: sample
          ? deriveMaintenanceReported(sampleData.maintenance.categories)
          : (m?.totalWorkOrders ?? null),
      },
      {
        label: e("open"),
        value: sample
          ? sampleData.openWorkOrders.value
          : (m?.openCount ?? null),
      },
      {
        label: e("completed"),
        value: sample
          ? sampleData.maintenance.completed
          : (m?.completedCount ?? null),
      },
      {
        label: e(sample ? "urgent" : "emergency"),
        value: sample
          ? sampleData.openWorkOrders.urgent
          : (m?.emergencyOpenCount ?? null),
      },
    ];
    series = [{ key: "count", label: e("workOrders"), color: blue }];
    rows = sample
      ? sampleData.maintenance.categories.map((c) => ({
          label: t(c.categoryKey),
          values: { count: c.countsByMonth.reduce((a, b) => a + b, 0) },
        }))
      : (data?.maintenance.byCategory ?? []).map((c) => ({
          label: e(`categories.${c.category}`),
          values: { count: c.count },
        }));
  } else {
    const c = data?.accounting.collections;
    metrics = [
      {
        label: e("billed"),
        value: sample
          ? sampleData.rentCollected.billed
          : c
            ? c.billedCents / 100
            : null,
        format: money,
      },
      {
        label: e("collected"),
        value: sample
          ? sampleData.rentCollected.value
          : c
            ? c.collectedCents / 100
            : null,
        format: money,
      },
      {
        label: e("pastDue"),
        value: sample
          ? sampleData.rentCollected.billed - sampleData.rentCollected.value
          : data?.accounting.aging
            ? data.accounting.aging.totalPastDueCents / 100
            : null,
        format: money,
      },
      {
        label: e("collectionRate"),
        value: sample
          ? derivedSample.rentCollectedPct
          : (c?.collectionRatePct ?? null),
        format: (n) => `${n.toFixed(1)}%`,
      },
    ];
    series = [
      { key: "income", label: e("income"), color: green },
      { key: "expense", label: e("expenses"), color: amber },
      { key: "noi", label: e("noi"), color: blue },
    ];
    const p = data?.accounting.profitAndLoss;
    rows = sample
      ? [
          {
            label: e("portfolio"),
            values: {
              income: sampleData.accounting.revenueSources.reduce(
                (a, b) => a + b.amount,
                0,
              ),
              expense: sampleData.accounting.expenses.reduce(
                (a, b) => a + b.amount,
                0,
              ),
              noi: sampleData.noi.value,
            },
          },
        ]
      : p
        ? [
            {
              label: e("portfolio"),
              values: {
                income: p.incomeCents / 100,
                expense: p.operatingExpenseCents / 100,
                noi: p.noiCents / 100,
              },
            },
          ]
        : [];
    secondaryTitle = e("receivablesAging");
    secondary = data?.accounting.aging
      ? Object.entries(data.accounting.aging.totals).map(([k, v]) => ({
          label: e(`aging.${k}`),
          values: { count: v / 100 },
        }))
      : [];
  }
  return (
    <div className="view-wrap operations-workspace">
      <header className="app-header">
        <div>
          <p className="eyebrow">{e("operations")}</p>
          <h1>{t(`Nav.${view}`)}</h1>
          <p className="header-subtitle">{e("operationsDescription")}</p>
        </div>
        <button className="soft-button" onClick={openConnections}>
          {e("manageSources")}
        </button>
      </header>
      <div className="enterprise-toolbar">
        <span className="enterprise-status">
          {e(sample ? "sampleData" : "workspaceData")}
        </span>
        <label className="enterprise-period">
          {e("period")}
          <select
            className="enterprise-select"
            value={period}
            disabled={sample}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {[
              "month_to_date",
              "prior_month",
              "last_30_days",
              "last_90_days",
              "year_to_date",
            ].map((p) => (
              <option key={p} value={p}>
                {e(`periods.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          disabled={sample || loaded.loading}
          aria-label={e("refresh")}
          onClick={() => setRevision((r) => r + 1)}
        >
          <Refresh width={18} height={18} />
        </button>
      </div>
      {loaded.error && !sample && (
        <div className="enterprise-error" role="alert">
          {e("loadError")}
          <button
            className="soft-button"
            onClick={() => setRevision((r) => r + 1)}
          >
            {e("retry")}
          </button>
        </div>
      )}
      <section
        className="metric-grid compact-metrics"
        aria-busy={loaded.loading && !sample}
      >
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>
              {loaded.loading && !sample
                ? "…"
                : m.value === null
                  ? "—"
                  : (m.format?.(m.value) ?? m.value.toLocaleString(locale))}
            </strong>
          </article>
        ))}
      </section>
      <section className="panel operations-chart-panel">
        <DataChart
          key={`${view}-${period}`}
          title={titles[view]}
          subtitle={e(sample ? "sampleDescription" : "chartDescription")}
          rows={rows}
          series={series}
          format={view === "accounting" ? money : undefined}
          axisFormat={view === "accounting" ? compactMoney : undefined}
        />
      </section>
      {secondary.length > 0 && (
        <section className="panel">
          <DataChart
            title={secondaryTitle}
            rows={secondary}
            series={[
              {
                key: "count",
                label: view === "accounting" ? e("balance") : e("leases"),
                color: blue,
              },
            ]}
            format={view === "accounting" ? money : undefined}
            axisFormat={view === "accounting" ? compactMoney : undefined}
          />
        </section>
      )}
      {!sample && data?.accounting.notes && view === "accounting" && (
        <div className="operations-notes">
          {data.accounting.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
