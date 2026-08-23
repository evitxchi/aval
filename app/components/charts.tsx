"use client";

import type { useTranslations } from "next-intl";
import {
  deriveAccountingTotals,
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

/**
 * Horizontal bar chart, one row per property. Bar length is occupied ÷
 * units; the fill color encodes occupancy health (green/amber/red) rather
 * than being a flat decoration, so the color carries real information.
 */
export function PropertyOccupancyChart({ t }: { t: T }) {
  const rows = sampleData.properties.list;
  const maxUnits = Math.max(...rows.map((row) => row.units));
  const healthColor = (pct: number) => (pct >= 95 ? VIZ.green : pct >= 85 ? VIZ.amber : VIZ.red);

  return (
    <div className="chart-frame property-chart" data-reveal data-sound-reveal role="img" aria-label={t("OperationsView.propertiesChartTitle")}>
      {rows.map((row) => {
        const occupiedPct = (row.occupied / row.units) * 100;
        const trackWidthPct = (row.units / maxUnits) * 100;
        return (
          <div className="property-row" key={row.nameKey}>
            <span className="property-row-label">{t(row.nameKey)}</span>
            <div className="property-row-track" style={{ width: `${trackWidthPct}%` }}>
              <div className="property-row-fill" style={{ "--fill-width": `${occupiedPct}%`, background: healthColor(occupiedPct) } as React.CSSProperties} />
            </div>
            <span className="property-row-value">
              {t("OperationsView.unitsOccupied", { occupied: row.occupied, units: row.units })}
              {row.readyForLeasing > 0 && <b className="property-ready-badge">{t("OperationsView.unitsReady", { count: row.readyForLeasing })}</b>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Nested-area trend: four series that are always ordered contacted ≥ viewed
 * ≥ applied ≥ signed, so they're drawn as layered, fully opaque, distinctly
 * colored fills — each color is only visible in the band between its own
 * curve and the next-smaller series, which is what makes the layering
 * legible (a single opaque top layer at full coverage would otherwise hide
 * everything underneath it).
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
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={t("OperationsView.leasingChartTitle")}>
        {series.map((entry, index) => (
          <path key={entry.key} d={areaPath(entry.key)} className="leasing-trend-area" style={{ fill: entry.color, "--reveal-delay": `${index * 110}ms` } as React.CSSProperties} />
        ))}
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
 * category holding a fixed, distinct color across every month.
 */
export function MaintenanceRoseChart({ t, locale }: { t: T; locale: string }) {
  const { months, categories } = sampleData.maintenance;
  const monthTotals = months.map((_, monthIndex) => categories.reduce((sum, category) => sum + category.countsByMonth[monthIndex], 0));
  const maxTotal = Math.max(...monthTotals);
  const size = 220;
  const center = size / 2;
  const maxRadius = center - 34;
  const anglePer = (2 * Math.PI) / months.length;
  const formatter = new Intl.DateTimeFormat(locale, { month: "short" });

  const point = (angle: number, radius: number) => [center + radius * Math.sin(angle), center - radius * Math.cos(angle)];

  return (
    <div className="chart-frame maintenance-rose" data-reveal data-sound-reveal>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label={t("OperationsView.maintenanceChartTitle")}>
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
                return <path key={category.categoryKey} d={path} className="rose-wedge" style={{ fill: ROSE_CATEGORY_COLORS[category.categoryKey] }} />;
              })}
              {(() => {
                const labelAngle = startAngle + anglePer * 0.43;
                const [lx, ly] = point(labelAngle, maxRadius + 16);
                return <text x={lx} y={ly} textAnchor="middle" className="chart-axis-label">{formatter.format(new Date(monthEntry.year, monthEntry.month - 1, 1))}</text>;
              })()}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend rose-legend">
        {categories.map((category) => (
          <span key={category.categoryKey} className="chart-legend-item">
            <i style={{ background: ROSE_CATEGORY_COLORS[category.categoryKey] }} />
            {t(category.categoryKey)}
          </span>
        ))}
      </div>
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
 */
function SankeyLabelColumn({ nodes, align, t, money }: { nodes: AccountingFlowNode[]; align: "left" | "right"; t: T; money: (amount: number) => string }) {
  return (
    <div className={`sankey-labels ${align}`}>
      {nodes.map((node) => (
        <div className="sankey-label-row" key={node.key} style={{ flexGrow: node.amount }}>
          <i style={{ background: SANKEY_COLORS[node.key] }} />
          <span>{t(node.labelKey)} · {money(node.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function AccountingSankey({ t, money }: { t: T; money: (amount: number) => string }) {
  const { revenueSources, expenses } = sampleData.accounting;
  const { totalRevenue } = deriveAccountingTotals();
  const destinations: AccountingFlowNode[] = [
    { key: "noi", labelKey: "Overview.noiLabel", amount: sampleData.noi.value },
    ...expenses,
  ];

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

  return (
    <div className="chart-frame accounting-sankey" data-reveal data-sound-reveal>
      <p className="chart-caption">{t("OperationsView.totalRevenue")} · {money(totalRevenue)}</p>
      <div className="sankey-body" role="img" aria-label={t("OperationsView.accountingChartTitle")}>
        <SankeyLabelColumn nodes={leftNodes} align="left" t={t} money={money}/>
        <svg className="sankey-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {leftNodes.map((node, index) => {
            const path = ribbon(node.x + nodeWidth, node.y, node.height, midNode.x, leftCursors[index], node.height);
            return <path key={node.key} d={path} className="sankey-link" style={{ fill: SANKEY_COLORS[node.key], "--reveal-delay": "0ms" } as React.CSSProperties} />;
          })}
          {rightNodes.map((node, index) => {
            const path = ribbon(midNode.x + nodeWidth, rightCursors[index], node.height, node.x, node.y, node.height);
            return <path key={node.key} d={path} className="sankey-link" style={{ fill: SANKEY_COLORS[node.key], "--reveal-delay": "120ms" } as React.CSSProperties} />;
          })}
          {leftNodes.map((node) => <rect key={node.key} x={node.x} y={node.y} width={nodeWidth} height={node.height} className="sankey-node" style={{ fill: SANKEY_COLORS[node.key] }} />)}
          <rect x={midNode.x} y={midNode.y} width={nodeWidth} height={midNode.height} className="sankey-node sankey-node-total" />
          {rightNodes.map((node) => <rect key={node.key} x={node.x} y={node.y} width={nodeWidth} height={node.height} className="sankey-node" style={{ fill: SANKEY_COLORS[node.key] }} />)}
        </svg>
        <SankeyLabelColumn nodes={rightNodes} align="right" t={t} money={money}/>
      </div>
    </div>
  );
}
