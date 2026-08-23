"use client";

import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { useTranslations } from "next-intl";
import { RefreshDouble } from "iconoir-react";
import {
  deriveAccountingTotals,
  derivePropertyTotals,
  sampleData,
  type AccountingFlowNode,
} from "@/app/data/sample";

type T = ReturnType<typeof useTranslations>;

/**
 * Categorical chart colors. These are real, saturated hues (CSS variables
 * defined in globals.css) — the app shell stays monochrome, but a chart
 * with 4+ series read as one indistinguishable gray blob without color
 * doing the actual work of separating them.
 */
const VIZ = {
  red: "var(--viz-red)",
  orange: "var(--viz-orange)",
  amber: "var(--viz-amber)",
  green: "var(--viz-green)",
  teal: "var(--viz-teal)",
  blue: "var(--viz-blue)",
  indigo: "var(--viz-indigo)",
  violet: "var(--viz-violet)",
  pink: "var(--viz-pink)",
};

type NarrativeKind = "insight" | "question" | "proposal";
type NarrativeItem = { kind: NarrativeKind; textKey: string; params?: Record<string, string | number> };

const NARRATIVE_KIND_LABEL: Record<NarrativeKind, string> = {
  insight: "OperationsView.narrativeKindInsight",
  question: "OperationsView.narrativeKindQuestion",
  proposal: "OperationsView.narrativeKindProposal",
};

const NARRATIVE_WINDOW_SIZE = 3;

/**
 * Cycles through a pool larger than what's shown at once, windowSize items
 * at a time, wrapping around — so "refresh" surfaces findings that were
 * always real and already computed, just not in the default view, rather
 * than fabricating something new. This is the seam a live model call
 * replaces later: same UI, real generation instead of a rotating pool.
 */
function rotateNarrativePool<Item>(pool: Item[], round: number, windowSize: number): Item[] {
  if (pool.length <= windowSize) return pool;
  const offset = (round * windowSize) % pool.length;
  return Array.from({ length: windowSize }, (_, index) => pool[(offset + index) % pool.length]);
}

/**
 * Every chart's takeaways, spelled out below it instead of left for the
 * viewer to infer. Each item's numbers come from the same sampleData the
 * chart itself renders — computed in the chart component, never a second,
 * separately-authored figure that could quietly drift from the chart above it.
 */
function ChartNarrative({ t, items, onRefresh, refreshing }: { t: T; items: NarrativeItem[]; onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <div className="chart-narrative">
      <div className="chart-narrative-top">
        <p className="chart-narrative-heading">{t("OperationsView.narrativeHeading")}</p>
        {onRefresh && (
          <button type="button" className="chart-narrative-refresh" onClick={onRefresh} disabled={refreshing}>
            <RefreshDouble width={12} height={12} className={refreshing ? "spinning" : ""}/>
            {t("OperationsView.narrativeRefresh")}
          </button>
        )}
      </div>
      <ul className={refreshing ? "is-refreshing" : ""}>
        {items.map((item) => (
          <li className={`narrative-${item.kind}`} key={item.textKey}>
            <span className="narrative-kind">{t(NARRATIVE_KIND_LABEL[item.kind])}</span>
            <span>{t(item.textKey, item.params)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Local refresh state shared by every chart's narrative pool: cycle the round after a short simulated delay. */
function useNarrativeRefresh() {
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => { setRound((current) => current + 1); setRefreshing(false); }, 650);
  };
  return { round, refreshing, refresh };
}

/**
 * Hover reveals a segment's detail transiently; click or Enter/Space pins it
 * — the only way a touch device (no hover state at all) or a keyboard user
 * gets to the same detail a mouse-hover gives everyone else.
 */
function useSegmentDetail() {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const activeKey = pinnedKey ?? hoverKey;
  const toggle = (key: string) => setPinnedKey((current) => (current === key ? null : key));
  const handlersFor = (key: string) => ({
    tabIndex: 0,
    role: "button" as const,
    onMouseEnter: () => setHoverKey(key),
    onMouseLeave: () => setHoverKey((current) => (current === key ? null : current)),
    onFocus: () => setHoverKey(key),
    onBlur: () => setHoverKey((current) => (current === key ? null : current)),
    onClick: () => toggle(key),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(key); }
    },
  });
  return { activeKey, handlersFor };
}

/** Floating detail card, positioned as a percentage of its SVG's own viewBox so it stays correct as the SVG scales responsively. */
function ChartTooltip({ x, y, viewBoxWidth, viewBoxHeight, children }: { x: number; y: number; viewBoxWidth: number; viewBoxHeight: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: `${(x / viewBoxWidth) * 100}%`, top: `${(y / viewBoxHeight) * 100}%` }}>
      {children}
    </div>
  );
}

/**
 * Horizontal bar chart, one row per property. Bar length is occupied ÷
 * units; the fill color encodes occupancy health (green/amber/red) rather
 * than being a flat decoration, so the color carries real information.
 * Clicking or hovering a row reveals its detail sentence inline below it.
 */
export function PropertyOccupancyChart({ t, locale }: { t: T; locale: string }) {
  const rows = sampleData.properties.list;
  const totals = derivePropertyTotals(rows);
  const portfolioPct = (totals.occupied / totals.units) * 100;
  const maxUnits = Math.max(...rows.map((row) => row.units));
  const healthColor = (pct: number) => (pct >= 95 ? VIZ.green : pct >= 85 ? VIZ.amber : VIZ.red);
  const { activeKey, handlersFor } = useSegmentDetail();
  const { round, refreshing, refresh } = useNarrativeRefresh();

  const rowsWithStats = rows.map((row) => ({
    ...row,
    occupiedPct: (row.occupied / row.units) * 100,
    downUnits: row.units - row.occupied - row.readyForLeasing,
  }));
  const weakest = rowsWithStats.reduce((min, row) => (row.occupiedPct < min.occupiedPct ? row : min));
  const strongest = rowsWithStats.reduce((max, row) => (row.occupiedPct > max.occupiedPct ? row : max));
  const biggest = rowsWithStats.reduce((max, row) => (row.units > max.units ? row : max));
  const downRows = rowsWithStats.filter((row) => row.downUnits > 0);
  const totalDown = downRows.reduce((sum, row) => sum + row.downUnits, 0);
  const highOccupancyRows = rowsWithStats.filter((row) => row.occupiedPct >= 95);
  const listFormatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const downDetail = listFormatter.format(downRows.map((row) => t("OperationsView.narrativeUnitCountAtProperty", { count: row.downUnits, property: t(row.nameKey) })));
  const highOccupancyDetail = listFormatter.format(highOccupancyRows.map((row) => t(row.nameKey)));

  const narrativePool: NarrativeItem[] = [
    { kind: "insight", textKey: "OperationsView.propertiesNarrativeSpread", params: { weakest: t(weakest.nameKey), weakestPct: weakest.occupiedPct.toFixed(1), portfolioPct: portfolioPct.toFixed(1), strongest: t(strongest.nameKey), strongestPct: strongest.occupiedPct.toFixed(1) } },
    ...(totalDown > 0 ? [{ kind: "question" as const, textKey: "OperationsView.propertiesNarrativeDownUnits", params: { count: totalDown, detail: downDetail } }] : []),
    { kind: "proposal" as const, textKey: "OperationsView.propertiesNarrativeProposal", params: { readyCount: totals.readyForLeasing, readyAtWeakest: weakest.readyForLeasing, weakest: t(weakest.nameKey) } },
    { kind: "insight" as const, textKey: "OperationsView.propertiesNarrativeLargest", params: { property: t(biggest.nameKey), units: biggest.units, pct: biggest.occupiedPct.toFixed(1) } },
    ...(highOccupancyRows.length > 0 ? [{ kind: "proposal" as const, textKey: "OperationsView.propertiesNarrativeRentReview", params: { detail: highOccupancyDetail } }] : []),
  ];
  const narrative = rotateNarrativePool(narrativePool, round, NARRATIVE_WINDOW_SIZE);

  return (
    <div className="chart-frame property-chart" data-reveal data-sound-reveal>
      <div role="group" aria-label={t("OperationsView.propertiesChartTitle")}>
        {rowsWithStats.map((row) => {
          const trackWidthPct = (row.units / maxUnits) * 100;
          const comparison = row.occupiedPct > portfolioPct + 0.05 ? "above" : row.occupiedPct < portfolioPct - 0.05 ? "below" : "at";
          const detail = t("OperationsView.propertyRowDetail", { occupied: row.occupied, units: row.units, pct: row.occupiedPct.toFixed(1), ready: row.readyForLeasing, comparison, portfolioPct: portfolioPct.toFixed(1) });
          const active = activeKey === row.nameKey;
          return (
            <div className={`property-row${active ? " active" : ""}`} key={row.nameKey} {...handlersFor(row.nameKey)} aria-label={`${t(row.nameKey)}: ${detail}`}>
              <span className="property-row-label">{t(row.nameKey)}</span>
              <div className="property-row-track" style={{ width: `${trackWidthPct}%` }}>
                <div className="property-row-fill" style={{ "--fill-width": `${row.occupiedPct}%`, background: healthColor(row.occupiedPct) } as React.CSSProperties} />
              </div>
              <span className="property-row-value">
                {t("OperationsView.unitsOccupied", { occupied: row.occupied, units: row.units })}
                {row.readyForLeasing > 0 && <b className="property-ready-badge">{t("OperationsView.unitsReady", { count: row.readyForLeasing })}</b>}
              </span>
              {active && <p className="property-row-detail">{detail}</p>}
            </div>
          );
        })}
      </div>
      <ChartNarrative t={t} items={narrative} onRefresh={refresh} refreshing={refreshing} />
    </div>
  );
}

/**
 * Nested-area trend: four series that are always ordered contacted ≥ viewed
 * ≥ applied ≥ signed, so they're drawn as layered, fully opaque, distinctly
 * colored fills — each color is only visible in the band between its own
 * curve and the next-smaller series, which is what makes the layering
 * legible (a single opaque top layer at full coverage would otherwise hide
 * everything underneath it). Hovering or clicking a week reveals every
 * series' value and conversion rate for that week.
 */
export function LeasingTrendChart({ t }: { t: T }) {
  const weeks = sampleData.leasing.trend;
  const width = 560;
  const height = 190;
  const padding = { top: 10, right: 26, bottom: 26, left: 26 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxValue = Math.max(...weeks.map((week) => week.contacted));
  const x = (index: number) => padding.left + (index / (weeks.length - 1)) * plotW;
  const y = (value: number) => padding.top + plotH - (value / maxValue) * plotH;
  const step = weeks.length > 1 ? plotW / (weeks.length - 1) : plotW;
  const { activeKey, handlersFor } = useSegmentDetail();

  const series: { key: "contacted" | "viewed" | "applied" | "signed"; labelKey: string; color: string }[] = [
    { key: "contacted", labelKey: "OperationsView.leasingLegendContacted", color: VIZ.indigo },
    { key: "viewed", labelKey: "OperationsView.leasingLegendViewed", color: VIZ.blue },
    { key: "applied", labelKey: "OperationsView.leasingLegendApplied", color: VIZ.amber },
    { key: "signed", labelKey: "OperationsView.leasingLegendSigned", color: VIZ.green },
  ];

  const areaPath = (key: (typeof series)[number]["key"]) => {
    const top = weeks.map((week, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(week[key])}`).join(" ");
    return `${top} L${x(weeks.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  };

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const contactedGrowthPct = ((last.contacted - first.contacted) / first.contacted) * 100;
  const signedGrowthPct = ((last.signed - first.signed) / first.signed) * 100;
  const firstConversionPct = (first.signed / first.contacted) * 100;
  const lastConversionPct = (last.signed / last.contacted) * 100;
  const everyStageImproved =
    last.viewed / last.contacted > first.viewed / first.contacted &&
    last.applied / last.viewed > first.applied / first.viewed &&
    last.signed / last.applied > first.signed / first.applied;
  const firstAppliedToSignedPct = (first.signed / first.applied) * 100;
  const lastAppliedToSignedPct = (last.signed / last.applied) * 100;

  const narrativePool: NarrativeItem[] = [
    { kind: "insight", textKey: "OperationsView.leasingNarrativeVolume", params: { contactedGrowthPct: contactedGrowthPct.toFixed(0), contactedStart: first.contacted, contactedEnd: last.contacted, signedGrowthPct: signedGrowthPct.toFixed(0), signedStart: first.signed, signedEnd: last.signed } },
    { kind: "insight" as const, textKey: "OperationsView.leasingNarrativeConversion", params: { startPct: firstConversionPct.toFixed(1), endPct: lastConversionPct.toFixed(1) } },
    ...(everyStageImproved ? [{ kind: "question" as const, textKey: "OperationsView.leasingNarrativeQuestion" }] : []),
    { kind: "proposal" as const, textKey: "OperationsView.leasingNarrativeProposal" },
    { kind: "insight" as const, textKey: "OperationsView.leasingNarrativeBiggestGain", params: { startPct: firstAppliedToSignedPct.toFixed(1), endPct: lastAppliedToSignedPct.toFixed(1) } },
    ...(everyStageImproved ? [{ kind: "question" as const, textKey: "OperationsView.leasingNarrativeSustainability", params: { contactedGrowthPct: contactedGrowthPct.toFixed(0) } }] : []),
  ];
  const { round, refreshing, refresh } = useNarrativeRefresh();
  const narrative = rotateNarrativePool(narrativePool, round, NARRATIVE_WINDOW_SIZE);

  return (
    <div className="chart-frame leasing-trend-chart" data-reveal data-sound-reveal>
      <div className="chart-legend">
        {series.map((entry) => (
          <span key={entry.key} className="chart-legend-item">
            <i style={{ background: entry.color }} />
            {t(entry.labelKey)}
          </span>
        ))}
      </div>
      <div className="chart-tooltip-anchor">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="group" aria-label={t("OperationsView.leasingChartTitle")}>
          {series.map((entry, index) => (
            <path key={entry.key} d={areaPath(entry.key)} className="leasing-trend-area" style={{ fill: entry.color, "--reveal-delay": `${index * 110}ms` } as React.CSSProperties} />
          ))}
          {weeks.map((week, index) => {
            const active = activeKey === week.labelKey;
            const label = t(week.labelKey);
            const detail = `${t("OperationsView.leasingTooltipBaseline", { label: t("OperationsView.leasingLegendContacted"), count: week.contacted })}; ${t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendViewed"), count: week.viewed, pct: ((week.viewed / week.contacted) * 100).toFixed(1) })}; ${t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendApplied"), count: week.applied, pct: ((week.applied / week.contacted) * 100).toFixed(1) })}; ${t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendSigned"), count: week.signed, pct: ((week.signed / week.contacted) * 100).toFixed(1) })}`;
            return (
              <g key={week.labelKey}>
                <rect
                  x={Math.max(padding.left, x(index) - step / 2)}
                  y={padding.top}
                  width={Math.min(step, plotW)}
                  height={plotH}
                  className="chart-hit-target"
                  {...handlersFor(week.labelKey)}
                  aria-label={`${label}: ${detail}`}
                />
                {active && <line x1={x(index)} x2={x(index)} y1={padding.top} y2={padding.top + plotH} className="leasing-guide-line" />}
              </g>
            );
          })}
          {weeks.map((week, index) => (
            <text
              key={week.labelKey}
              x={x(index)}
              y={height - 6}
              textAnchor={index === 0 ? "start" : index === weeks.length - 1 ? "end" : "middle"}
              className="chart-axis-label"
            >
              {t(week.labelKey)}
            </text>
          ))}
        </svg>
        {weeks.map((week, index) => {
          if (activeKey !== week.labelKey) return null;
          return (
            <ChartTooltip key={week.labelKey} x={x(index)} y={padding.top} viewBoxWidth={width} viewBoxHeight={height}>
              <strong>{t(week.labelKey)}</strong>
              <span>{t("OperationsView.leasingTooltipBaseline", { label: t("OperationsView.leasingLegendContacted"), count: week.contacted })}</span>
              <span>{t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendViewed"), count: week.viewed, pct: ((week.viewed / week.contacted) * 100).toFixed(1) })}</span>
              <span>{t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendApplied"), count: week.applied, pct: ((week.applied / week.contacted) * 100).toFixed(1) })}</span>
              <span>{t("OperationsView.leasingTooltipConversion", { label: t("OperationsView.leasingLegendSigned"), count: week.signed, pct: ((week.signed / week.contacted) * 100).toFixed(1) })}</span>
            </ChartTooltip>
          );
        })}
      </div>
      <ChartNarrative t={t} items={narrative} onRefresh={refresh} refreshing={refreshing} />
    </div>
  );
}

const ROSE_CATEGORY_COLORS: Record<string, string> = {
  "OperationsView.categoryPlumbing": VIZ.blue,
  "OperationsView.categoryElectrical": VIZ.amber,
  "OperationsView.categoryHvac": VIZ.teal,
  "OperationsView.categoryAppliance": VIZ.violet,
  "OperationsView.categoryStructural": VIZ.red,
};

/**
 * Nightingale rose (coxcomb): one wedge per month, stacked by category
 * outward from the center. Radius encodes each month's total request
 * volume; the stack within a wedge shows category composition, each
 * category holding a fixed, distinct color across every month. Capped at a
 * modest max-width in CSS — at viewBox 220×220 with width:100%, an
 * unconstrained square chart stretches to the full width of a wide
 * operations panel and becomes taller than the panel is meant to hold.
 */
export function MaintenanceRoseChart({ t, locale }: { t: T; locale: string }) {
  const { months, categories } = sampleData.maintenance;
  const monthTotals = months.map((_, monthIndex) => categories.reduce((sum, category) => sum + category.countsByMonth[monthIndex], 0));
  const grandTotal = monthTotals.reduce((sum, total) => sum + total, 0);
  const maxTotal = Math.max(...monthTotals);
  const size = 220;
  const center = size / 2;
  const maxRadius = center - 34;
  const anglePer = (2 * Math.PI) / months.length;
  const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const monthLabels = months.map((month) => formatter.format(new Date(month.year, month.month - 1, 1)));
  const { activeKey, handlersFor } = useSegmentDetail();

  const point = (angle: number, radius: number) => [center + radius * Math.sin(angle), center - radius * Math.cos(angle)];

  const categoryTotals = categories.map((category) => ({ category, total: category.countsByMonth.reduce((sum, count) => sum + count, 0) }));
  const leadCategory = categoryTotals.reduce((max, entry) => (entry.total > max.total ? entry : max));
  const leadCategoryLeadsEveryMonth = months.every((_, monthIndex) => {
    const monthMax = Math.max(...categories.map((category) => category.countsByMonth[monthIndex]));
    return leadCategory.category.countsByMonth[monthIndex] === monthMax;
  });
  const runnerUp = categoryTotals.filter((entry) => entry.category.categoryKey !== leadCategory.category.categoryKey).reduce((max, entry) => (entry.total > max.total ? entry : max));
  const secondPlaceTies = categoryTotals.filter((entry) => entry.category.categoryKey !== leadCategory.category.categoryKey && entry.total === runnerUp.total);
  const plumbing = categories.find((category) => category.categoryKey === "OperationsView.categoryPlumbing");
  const structural = categories.find((category) => category.categoryKey === "OperationsView.categoryStructural");
  const seesawSigns = plumbing && structural ? months.map((_, index) => Math.sign(plumbing.countsByMonth[index] - structural.countsByMonth[index])) : [];
  const seesawPattern = seesawSigns.length > 1 && seesawSigns.every((value, index) => index === 0 || (value !== 0 && value === -seesawSigns[index - 1]));

  const narrativePool: NarrativeItem[] = [
    { kind: "insight", textKey: "OperationsView.maintenanceNarrativeShare", params: { category: t(leadCategory.category.categoryKey), count: leadCategory.total, total: grandTotal, pct: ((leadCategory.total / grandTotal) * 100).toFixed(0) } },
    ...(leadCategoryLeadsEveryMonth ? [{ kind: "question" as const, textKey: "OperationsView.maintenanceNarrativeConsistency", params: { category: t(leadCategory.category.categoryKey) } }] : []),
    { kind: "proposal" as const, textKey: "OperationsView.maintenanceNarrativeProposal", params: { category: t(leadCategory.category.categoryKey) } },
    ...(secondPlaceTies.length > 1 ? [{ kind: "insight" as const, textKey: "OperationsView.maintenanceNarrativeSecondTie", params: { categories: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(secondPlaceTies.map((entry) => t(entry.category.categoryKey))), count: runnerUp.total } }] : []),
    ...(seesawPattern ? [{ kind: "question" as const, textKey: "OperationsView.maintenanceNarrativeSeesaw" }] : []),
  ];
  const { round, refreshing, refresh } = useNarrativeRefresh();
  const narrative = rotateNarrativePool(narrativePool, round, NARRATIVE_WINDOW_SIZE);

  return (
    <div className="chart-frame maintenance-rose" data-reveal data-sound-reveal>
      <div className="chart-tooltip-anchor">
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="group" aria-label={t("OperationsView.maintenanceChartTitle")}>
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <circle key={ring} cx={center} cy={center} r={maxRadius * ring} className="rose-gridline" />
          ))}
          {months.map((monthEntry, monthIndex) => {
            const startAngle = monthIndex * anglePer;
            const endAngle = startAngle + anglePer * 0.86;
            let innerRadius = 0;
            return (
              <g key={`${monthEntry.year}-${monthEntry.month}`} style={{ "--reveal-delay": `${monthIndex * 90}ms` } as React.CSSProperties}>
                {categories.map((category) => {
                  const value = category.countsByMonth[monthIndex];
                  const outerRadius = innerRadius + (value / maxTotal) * maxRadius;
                  const [x1, y1] = point(startAngle, innerRadius);
                  const [x2, y2] = point(startAngle, outerRadius);
                  const [x3, y3] = point(endAngle, outerRadius);
                  const [x4, y4] = point(endAngle, innerRadius);
                  const path = `M${x1},${y1} L${x2},${y2} A${outerRadius},${outerRadius} 0 0 1 ${x3},${y3} L${x4},${y4} A${innerRadius},${innerRadius} 0 0 0 ${x1},${y1} Z`;
                  innerRadius = outerRadius;
                  const key = `${category.categoryKey}-${monthIndex}`;
                  const monthTotal = monthTotals[monthIndex];
                  const detail = t("OperationsView.maintenanceTooltipDetail", { month: monthLabels[monthIndex], count: value, monthTotal, pct: monthTotal > 0 ? ((value / monthTotal) * 100).toFixed(0) : "0" });
                  return (
                    <path
                      key={key}
                      d={path}
                      className={`rose-wedge${activeKey === key ? " active" : ""}`}
                      style={{ fill: ROSE_CATEGORY_COLORS[category.categoryKey] }}
                      {...handlersFor(key)}
                      aria-label={`${t(category.categoryKey)} — ${detail}`}
                    />
                  );
                })}
                {(() => {
                  const labelAngle = startAngle + anglePer * 0.43;
                  const [lx, ly] = point(labelAngle, maxRadius + 16);
                  return <text x={lx} y={ly} textAnchor="middle" className="chart-axis-label">{monthLabels[monthIndex]}</text>;
                })()}
              </g>
            );
          })}
        </svg>
        {months.map((monthEntry, monthIndex) =>
          categories.map((category, categoryIndex) => {
            const key = `${category.categoryKey}-${monthIndex}`;
            if (activeKey !== key) return null;
            const startAngle = monthIndex * anglePer;
            const innerRadius = categories.slice(0, categoryIndex).reduce((sum, prior) => sum + (prior.countsByMonth[monthIndex] / maxTotal) * maxRadius, 0);
            const value = category.countsByMonth[monthIndex];
            const outerRadius = innerRadius + (value / maxTotal) * maxRadius;
            const midAngle = startAngle + anglePer * 0.43;
            const [tx, ty] = point(midAngle, (innerRadius + outerRadius) / 2);
            const monthTotal = monthTotals[monthIndex];
            return (
              <ChartTooltip key={key} x={tx} y={ty} viewBoxWidth={size} viewBoxHeight={size}>
                <strong>{t(category.categoryKey)}</strong>
                <span>{t("OperationsView.maintenanceTooltipDetail", { month: monthLabels[monthIndex], count: value, monthTotal, pct: monthTotal > 0 ? ((value / monthTotal) * 100).toFixed(0) : "0" })}</span>
              </ChartTooltip>
            );
          }),
        )}
      </div>
      <div className="chart-legend rose-legend">
        {categories.map((category) => (
          <span key={category.categoryKey} className="chart-legend-item">
            <i style={{ background: ROSE_CATEGORY_COLORS[category.categoryKey] }} />
            {t(category.categoryKey)}
          </span>
        ))}
      </div>
      <ChartNarrative t={t} items={narrative} onRefresh={refresh} refreshing={refreshing} />
    </div>
  );
}

const SANKEY_COLORS: Record<string, string> = {
  rentBilled: VIZ.blue,
  otherIncome: VIZ.teal,
  noi: VIZ.green,
  maintenance: VIZ.orange,
  utilities: VIZ.amber,
  management: VIZ.violet,
  taxes: VIZ.red,
  insurance: VIZ.pink,
};

/**
 * Two-stage Sankey: revenue sources flow into a single Total revenue node,
 * which splits into NOI and every expense category. Node heights and link
 * widths are both proportional to amount, laid out by hand (fixed 3-column
 * layout) rather than via a layout library. Each destination gets its own
 * color, carried through into its ribbon at reduced opacity — the
 * conventional Sankey convention of coloring a flow by where it's going.
 * The label rows and the SVG node bars share one activeKey, so hovering
 * either highlights and explains the same underlying figure.
 */
function SankeyLabelColumn({ nodes, align, t, money, activeKey, handlersFor }: {
  nodes: (AccountingFlowNode & { pctOfRevenue: string })[]; align: "left" | "right"; t: T; money: (amount: number) => string;
  activeKey: string | null; handlersFor: ReturnType<typeof useSegmentDetail>["handlersFor"];
}) {
  return (
    <div className={`sankey-labels ${align}`}>
      {nodes.map((node) => (
        <div
          className={`sankey-label-row${activeKey === node.key ? " active" : ""}`}
          key={node.key}
          style={{ flexGrow: node.amount }}
          {...handlersFor(node.key)}
          aria-label={`${t(node.labelKey)}: ${money(node.amount)}, ${node.pctOfRevenue}% ${t("OperationsView.totalRevenue")}`}
        >
          <i style={{ background: SANKEY_COLORS[node.key] }} />
          <span>{t(node.labelKey)} · {money(node.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function AccountingSankey({ t, money }: { t: T; money: (amount: number) => string }) {
  const { revenueSources, expenses } = sampleData.accounting;
  const { totalRevenue, totalExpenses } = deriveAccountingTotals();
  const destinations: AccountingFlowNode[] = [
    { key: "noi", labelKey: "Overview.noiLabel", amount: sampleData.noi.value },
    ...expenses,
  ];
  const withShare = (nodes: AccountingFlowNode[]) => nodes.map((node) => ({ ...node, pctOfRevenue: ((node.amount / totalRevenue) * 100).toFixed(1) }));
  const { activeKey, handlersFor } = useSegmentDetail();

  const maintenance = expenses.find((expense) => expense.key === "maintenance")!;
  const nextExpense = expenses.filter((expense) => expense.key !== "maintenance").reduce((max, expense) => (expense.amount > max.amount ? expense : max));
  const otherIncome = revenueSources.find((source) => source.key === "otherIncome")!;
  const noiMarginPct = (sampleData.noi.value / totalRevenue) * 100;
  const management = expenses.find((expense) => expense.key === "management")!;
  const taxes = expenses.find((expense) => expense.key === "taxes")!;
  const utilities = expenses.find((expense) => expense.key === "utilities")!;
  const narrativePool: NarrativeItem[] = [
    { kind: "insight", textKey: "OperationsView.accountingNarrativeLargestExpense", params: { category: t(maintenance.labelKey), amount: money(maintenance.amount), pct: ((maintenance.amount / totalExpenses) * 100).toFixed(1), nextCategory: t(nextExpense.labelKey), nextAmount: money(nextExpense.amount) } },
    { kind: "question" as const, textKey: "OperationsView.accountingNarrativeOtherIncome", params: { label: t(otherIncome.labelKey), pct: ((otherIncome.amount / totalRevenue) * 100).toFixed(1), amount: money(otherIncome.amount) } },
    { kind: "proposal" as const, textKey: "OperationsView.accountingNarrativeMargin", params: { marginPct: noiMarginPct.toFixed(1), category: t(maintenance.labelKey) } },
    { kind: "insight" as const, textKey: "OperationsView.accountingNarrativeFixedCosts", params: { management: t(management.labelKey), managementAmount: money(management.amount), taxes: t(taxes.labelKey), taxesAmount: money(taxes.amount) } },
    { kind: "question" as const, textKey: "OperationsView.accountingNarrativeUtilitiesConcentration", params: { category: t(utilities.labelKey), amount: money(utilities.amount) } },
  ];
  const { round, refreshing, refresh } = useNarrativeRefresh();
  const narrative = rotateNarrativePool(narrativePool, round, NARRATIVE_WINDOW_SIZE);

  // The SVG only draws ribbons and node bars, at a fixed pixel height with
  // preserveAspectRatio="none" so it can stretch to fill a flex row. Labels
  // are real HTML in flex columns beside it, each row's flex-grow set to
  // its node's amount — since both sides sum to totalRevenue over the same
  // height, this lines up with the SVG's own stacking without duplicating
  // pixel math, and HTML text wraps instead of clipping at a guessed width
  // (the fixed problem: longer Spanish category names overflowing an
  // in-SVG text element sized for English).
  const width = 360;
  const height = 280;
  const nodeWidth = 14;
  const gutter = 20;
  const columnX = { left: gutter, mid: width / 2 - nodeWidth / 2, right: width - gutter - nodeWidth };
  const pxPerUnit = height / totalRevenue;

  const stack = (nodes: AccountingFlowNode[], x: number) => {
    let y = (height - nodes.reduce((sum, node) => sum + node.amount * pxPerUnit, 0)) / 2;
    return nodes.map((node) => {
      const nodeHeight = Math.max(node.amount * pxPerUnit, 2);
      const laid = { ...node, x, y, height: nodeHeight };
      y += nodeHeight;
      return laid;
    });
  };

  const leftNodes = stack(revenueSources, columnX.left);
  const midNode = { x: columnX.mid, y: (height - totalRevenue * pxPerUnit) / 2, height: totalRevenue * pxPerUnit };
  const rightNodes = stack(destinations, columnX.right);

  const ribbon = (fromX: number, fromY: number, fromH: number, toX: number, toY: number, toH: number) => {
    const midX = (fromX + toX) / 2;
    return `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY} L${toX},${toY + toH} C${midX},${toY + toH} ${midX},${fromY + fromH} ${fromX},${fromY + fromH} Z`;
  };

  // Cumulative offsets into the shared "Total revenue" node's height, one
  // per link, computed functionally rather than mutated during the render
  // that draws them.
  const cursorsFor = (nodes: { height: number }[]) =>
    nodes.reduce<number[]>((cursors, node, index) => [...cursors, index === 0 ? midNode.y : cursors[index - 1] + nodes[index - 1].height], []);
  const leftCursors = cursorsFor(leftNodes);
  const rightCursors = cursorsFor(rightNodes);

  const nodeDetail = (node: AccountingFlowNode) => `${t(node.labelKey)}: ${money(node.amount)} (${((node.amount / totalRevenue) * 100).toFixed(1)}% ${t("OperationsView.totalRevenue")})`;

  return (
    <div className="chart-frame accounting-sankey" data-reveal data-sound-reveal>
      <p className="chart-caption">{t("OperationsView.totalRevenue")} · {money(totalRevenue)}</p>
      <div className="sankey-body">
        <SankeyLabelColumn nodes={withShare(leftNodes)} align="left" t={t} money={money} activeKey={activeKey} handlersFor={handlersFor} />
        <div className="chart-tooltip-anchor sankey-tooltip-anchor">
          <svg className="sankey-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="group" aria-label={t("OperationsView.accountingChartTitle")}>
            {leftNodes.map((node, index) => {
              const path = ribbon(node.x + nodeWidth, node.y, node.height, midNode.x, leftCursors[index], node.height);
              return <path key={node.key} d={path} className="sankey-link" style={{ fill: SANKEY_COLORS[node.key], "--reveal-delay": "0ms" } as React.CSSProperties} />;
            })}
            {rightNodes.map((node, index) => {
              const path = ribbon(midNode.x + nodeWidth, rightCursors[index], node.height, node.x, node.y, node.height);
              return <path key={node.key} d={path} className="sankey-link" style={{ fill: SANKEY_COLORS[node.key], "--reveal-delay": "120ms" } as React.CSSProperties} />;
            })}
            {leftNodes.map((node) => <rect key={node.key} x={node.x} y={node.y} width={nodeWidth} height={node.height} className={`sankey-node${activeKey === node.key ? " active" : ""}`} style={{ fill: SANKEY_COLORS[node.key] }} {...handlersFor(node.key)} aria-label={nodeDetail(node)} />)}
            <rect x={midNode.x} y={midNode.y} width={nodeWidth} height={midNode.height} className="sankey-node sankey-node-total" />
            {rightNodes.map((node) => <rect key={node.key} x={node.x} y={node.y} width={nodeWidth} height={node.height} className={`sankey-node${activeKey === node.key ? " active" : ""}`} style={{ fill: SANKEY_COLORS[node.key] }} {...handlersFor(node.key)} aria-label={nodeDetail(node)} />)}
          </svg>
          {[...leftNodes, ...rightNodes].map((node) => {
            if (activeKey !== node.key) return null;
            return (
              <ChartTooltip key={node.key} x={node.x + nodeWidth / 2} y={node.y + node.height / 2} viewBoxWidth={width} viewBoxHeight={height}>
                <strong>{t(node.labelKey)}</strong>
                <span>{t("OperationsView.accountingTooltipShare", { amount: money(node.amount), pct: ((node.amount / totalRevenue) * 100).toFixed(1) })}</span>
              </ChartTooltip>
            );
          })}
        </div>
        <SankeyLabelColumn nodes={withShare(rightNodes)} align="right" t={t} money={money} activeKey={activeKey} handlersFor={handlersFor} />
      </div>
      <ChartNarrative t={t} items={narrative} onRefresh={refresh} refreshing={refreshing} />
    </div>
  );
}
