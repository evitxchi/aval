"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Refresh } from "iconoir-react";
import type { OperationsOverview } from "@/lib/operations/summary";
import { DataChart, type ChartRow, type ChartSeries } from "./data-chart";
import { useExperience } from "./experience";
type OperationsModule =
  "properties" | "leasing" | "maintenance" | "accounting" | "overview";
const palette = [
  "var(--viz-blue)",
  "var(--viz-green)",
  "var(--viz-indigo)",
  "var(--viz-amber)",
  "#e78bb0",
  "#50bfc7",
];
export function OperationsWorkspace({
  view,
  openConnections,
  hero,
}: {
  view: OperationsModule;
  openConnections: () => void;
  hero?: ReactNode;
}) {
  const t = useTranslations(),
    e = useTranslations("Enterprise"),
    c = useTranslations("Charts"),
    locale = useLocale();
  const { market } = useExperience();
  const [period, setPeriod] = useState("month_to_date"),
    [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{
    data: OperationsOverview | null;
    loading: boolean;
    error: boolean;
  }>({ data: null, loading: true, error: false });
  useEffect(() => {
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
  }, [period, revision]);
  const data = loaded.data;
  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: market === "latam" ? "MXN" : "USD",
      maximumFractionDigits: 0,
    }).format(n);
  const compactMoney = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: market === "latam" ? "MXN" : "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const occupancyRows: ChartRow[] = (data?.portfolio.unitMix ?? []).map(
    (r) => ({
      label: r.label,
      values: { occupied: r.occupied, vacant: r.units - r.occupied },
    }),
  );
  const occupancySeries = [
    { key: "occupied", label: e("occupied"), color: palette[0] },
    { key: "vacant", label: e("unoccupied"), color: palette[3] },
  ];
  const funnelRows = (data?.leasing.funnel ?? []).map((s) => ({
    label: e(`stages.${s.stage}`),
    values: { count: s.reached },
  }));
  const categories = (data?.maintenance.byCategory ?? []).map((r) => ({
    label: e(`categories.${r.category}`),
    values: { count: r.count },
  }));
  const pnl = data?.accounting.profitAndLoss;
  const pnlRows: ChartRow[] = (data?.accounting.byProperty ?? []).map((p) => ({
    label: p.propertyName ?? c("unassigned"),
    values: {
      income: p.incomeCents / 100,
      expense: p.operatingExpenseCents / 100,
      noi: p.noiCents / 100,
    },
  }));
  if (!pnlRows.length && pnl)
    pnlRows.push({
      label: e("portfolio"),
      values: {
        income: pnl.incomeCents / 100,
        expense: pnl.operatingExpenseCents / 100,
        noi: pnl.noiCents / 100,
      },
    });
  const cashSeries: ChartSeries[] = [
    { key: "income", label: e("income"), color: palette[1] },
    { key: "expense", label: e("expenses"), color: palette[3] },
    { key: "noi", label: e("noi"), color: palette[2] },
  ];
  const timeline = data?.accounting.timeline;
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      ...(timeline?.granularity === "day"
        ? { day: "numeric" as const }
        : { year: "2-digit" as const }),
      timeZone: "UTC",
    }).format(new Date(date));
  const cashRows: ChartRow[] = (timeline?.rows ?? []).map((r) => ({
    label: dateLabel(r.start),
    values: {
      income: r.incomeCents / 100,
      expense: r.expenseCents / 100,
      noi: r.noiCents / 100,
    },
  }));
  const incomeRows: ChartRow[] = (timeline?.rows ?? []).map((r) => ({
    label: dateLabel(r.start),
    values: Object.fromEntries(
      Object.entries(r.income).map(([k, v]) => [k, v / 100]),
    ),
  }));
  const incomeSeries = (timeline?.incomeSeries ?? []).map((s, i) => ({
    ...s,
    label: s.label ?? c("otherIncome"),
    color: palette[i % palette.length],
  }));
  let metrics: {
    label: string;
    value: number | null;
    format?: (n: number) => string;
  }[] = [];
  if (view === "overview")
    metrics = [
      {
        label: e("noi"),
        value:
          data?.headline.noiCents == null ? null : data.headline.noiCents / 100,
        format: money,
      },
      {
        label: c("physicalOccupancy"),
        value: data?.headline.physicalOccupancyPct ?? null,
        format: pct,
      },
      {
        label: e("collectionRate"),
        value: data?.headline.collectionRatePct ?? null,
        format: pct,
      },
      { label: e("open"), value: data?.headline.openWorkOrders ?? null },
    ];
  else if (view === "properties")
    metrics = [
      {
        label: t("Nav.properties"),
        value: data?.portfolio.propertyCount ?? null,
      },
      {
        label: e("units"),
        value: data?.portfolio.occupancy.totalUnits ?? null,
      },
      {
        label: e("occupied"),
        value: data?.portfolio.occupancy.occupiedUnits ?? null,
      },
      {
        label: e("available"),
        value: data?.portfolio.occupancy.availableToLeaseUnits ?? null,
      },
    ];
  else if (view === "leasing")
    metrics = (data?.leasing.funnel ?? [])
      .slice(0, 4)
      .map((s) => ({ label: e(`stages.${s.stage}`), value: s.reached }));
  else if (view === "maintenance")
    metrics = [
      {
        label: e("reported"),
        value: data?.maintenance.summary.totalWorkOrders ?? null,
      },
      { label: e("open"), value: data?.maintenance.summary.openCount ?? null },
      {
        label: e("completed"),
        value: data?.maintenance.summary.completedCount ?? null,
      },
      {
        label: e("emergency"),
        value: data?.maintenance.summary.emergencyOpenCount ?? null,
      },
    ];
  else
    metrics = [
      {
        label: e("billed"),
        value: data?.accounting.collections
          ? data.accounting.collections.billedCents / 100
          : null,
        format: money,
      },
      {
        label: e("collected"),
        value: data?.accounting.collections
          ? data.accounting.collections.collectedCents / 100
          : null,
        format: money,
      },
      {
        label: e("pastDue"),
        value: data?.accounting.aging
          ? data.accounting.aging.totalPastDueCents / 100
          : null,
        format: money,
      },
      {
        label: e("collectionRate"),
        value: data?.accounting.collections?.collectionRatePct ?? null,
        format: pct,
      },
    ];
  const common = { loading: loaded.loading, compact: view === "overview" };
  const currency = { format: money, axisFormat: compactMoney };
  return (
    <div className="view-wrap operations-workspace">
      {hero}
      <header className="app-header">
        <div>
          <p className="eyebrow">{e("operations")}</p>
          <h1>
            {t(view === "overview" ? "Nav.portfolioOverview" : `Nav.${view}`)}
          </h1>
          <p className="header-subtitle">{c("description")}</p>
        </div>
        <button className="soft-button" onClick={openConnections}>
          {e("manageSources")}
        </button>
      </header>
      <div className="enterprise-toolbar">
        <span className="enterprise-status">{e("workspaceData")}</span>
        <label className="enterprise-period">
          {e("period")}
          <select
            className="enterprise-select"
            value={period}
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
          disabled={loaded.loading}
          aria-label={e("refresh")}
          onClick={() => setRevision((r) => r + 1)}
        >
          <Refresh width={18} height={18} />
        </button>
      </div>
      {loaded.error && (
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
      {data?.isEmpty && (
        <div className="operations-empty-note">
          <p>{c("empty")}</p>
          <button className="soft-button" onClick={openConnections}>
            {e("manageSources")}
          </button>
        </div>
      )}
      <section
        className="metric-grid compact-metrics"
        aria-busy={loaded.loading}
      >
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>
              {loaded.loading
                ? "…"
                : m.value === null
                  ? "—"
                  : (m.format?.(m.value) ?? m.value.toLocaleString(locale))}
            </strong>
          </article>
        ))}
      </section>
      <div
        className={
          view === "overview" ? "portfolio-chart-grid" : "operations-chart-grid"
        }
      >
        {(view === "overview" || view === "accounting") && (
          <section className="panel chart-wide">
            <DataChart
              {...common}
              {...currency}
              chartId={`${view}.cash`}
              title={c("cashFlow")}
              subtitle={c("cashFlowNote")}
              rows={cashRows}
              series={cashSeries}
              temporal
              initialKind="area"
            />
          </section>
        )}
        {(view === "overview" || view === "properties") && (
          <section className="panel">
            <DataChart
              {...common}
              chartId={`${view}.occupancy`}
              title={e("occupancyByType")}
              subtitle={c("occupancyNote")}
              rows={occupancyRows}
              series={occupancySeries}
              additive
              initialKind="stacked"
            />
          </section>
        )}
        {(view === "overview" || view === "leasing") && (
          <section className="panel">
            <DataChart
              {...common}
              chartId={`${view}.funnel`}
              title={e("leasingFunnel")}
              subtitle={c("funnelNote")}
              rows={funnelRows}
              series={[{ key: "count", label: e("leads"), color: palette[0] }]}
              initialKind="horizontal"
            />
          </section>
        )}
        {(view === "overview" || view === "maintenance") && (
          <section className="panel">
            <DataChart
              {...common}
              chartId={`${view}.maintenance`}
              title={e("workByCategory")}
              subtitle={e("chartDescription")}
              rows={categories}
              series={[
                { key: "count", label: e("workOrders"), color: palette[2] },
              ]}
              initialKind="dots"
            />
          </section>
        )}
        {(view === "overview" || view === "leasing") && (
          <section className="panel">
            <DataChart
              {...common}
              chartId={`${view}.expirations`}
              title={e("leaseExpirations")}
              subtitle={c("expirationNote")}
              rows={(data?.leasing.expirations.schedule ?? []).map((r) => ({
                label: r.month,
                values: { count: r.leaseCount },
              }))}
              series={[{ key: "count", label: e("leases"), color: palette[1] }]}
              temporal
              initialKind="steps"
            />
          </section>
        )}
        {view === "properties" && (
          <section className="panel">
            <DataChart
              {...common}
              {...currency}
              chartId="properties.rents"
              title={c("rentPosition")}
              subtitle={c("rentPositionNote")}
              rows={
                data?.portfolio.occupancy.totalUnits
                  ? [
                      {
                        label: c("marketRent"),
                        values: {
                          amount:
                            data.portfolio.rentPosition
                              .grossPotentialRentCents / 100,
                        },
                      },
                      {
                        label: c("contractRent"),
                        values: {
                          amount:
                            data.portfolio.rentPosition.inPlaceRentCents / 100,
                        },
                      },
                    ]
                  : []
              }
              series={[
                { key: "amount", label: c("monthlyRent"), color: palette[1] },
              ]}
              initialKind="horizontal"
            />
          </section>
        )}
        {view === "maintenance" && (
          <section className="panel">
            <DataChart
              {...common}
              {...currency}
              chartId="maintenance.spend"
              title={c("maintenanceSpend")}
              rows={(data?.maintenance.spendByProperty ?? []).map((r) => ({
                label: r.propertyName,
                values: { cost: r.totalCostCents / 100 },
              }))}
              series={[
                { key: "cost", label: e("expenses"), color: palette[3] },
              ]}
              initialKind="horizontal"
            />
          </section>
        )}
        {(view === "overview" || view === "accounting") && (
          <section className="panel chart-wide">
            <DataChart
              {...common}
              {...currency}
              chartId={`${view}.incomeMix`}
              title={c("incomeMix")}
              subtitle={c("incomeMixNote")}
              rows={incomeRows}
              series={incomeSeries}
              temporal
              additive
              initialKind="stackedArea"
            />
          </section>
        )}
        {view === "accounting" && (
          <>
            <section className="panel">
              <DataChart
                {...common}
                {...currency}
                chartId="accounting.properties"
                title={e("incomeExpenses")}
                subtitle={c("propertyProfitNote")}
                rows={pnlRows}
                series={cashSeries}
              />
            </section>
            <section className="panel">
              <DataChart
                {...common}
                {...currency}
                chartId="accounting.aging"
                title={e("receivablesAging")}
                rows={
                  data?.accounting.aging
                    ? Object.entries(data.accounting.aging.totals).map(
                        ([k, v]) => ({
                          label: e(`aging.${k}`),
                          values: { count: v / 100 },
                        }),
                      )
                    : []
                }
                series={[
                  { key: "count", label: e("balance"), color: palette[3] },
                ]}
                initialKind="horizontal"
              />
            </section>
          </>
        )}
      </div>
      {(view === "overview" || view === "accounting") && (
        <div className="operations-notes">
          {data?.accounting.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
