"use client";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { chartDomain } from "@/lib/charts/domain";
export interface ChartRow {
  label: string;
  values: Record<string, number | null>;
}
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}
/** Zero-based comparable bars; negative values retain their sign and baseline. */
export function DataChart({
  title,
  subtitle,
  rows,
  series,
  format,
  axisFormat,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  rows: ChartRow[];
  series: ChartSeries[];
  format?: (value: number) => string;
  axisFormat?: (value: number) => string;
  compact?: boolean;
}) {
  const t = useTranslations("Enterprise");
  const locale = useLocale();
  const id = useId();
  const [hidden, setHidden] = useState<string[]>([]);
  const [table, setTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const visible = series.filter((s) => !hidden.includes(s.key));
  const numbers = rows
    .flatMap((r) => visible.map((s) => r.values[s.key]))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const { top, bottom, ticks } = chartDomain(numbers);
  const width = Math.max(620, rows.length * 90 + 90),
    height = compact ? 230 : 300,
    left = 65,
    right = 20,
    plotHeight = height - 65,
    plotWidth = width - left - right;
  const y = (n: number) => 20 + ((top - n) / (top - bottom)) * plotHeight;
  const band = plotWidth / Math.max(rows.length, 1),
    barW = Math.min(36, (band - 20) / Math.max(visible.length, 1));
  const value = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n)
      ? (format?.(n) ??
        new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n))
      : "—";
  return (
    <section className="data-chart" aria-labelledby={id}>
      <div className="data-chart-heading">
        <div>
          <h3 id={id}>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="soft-button"
          aria-pressed={table}
          onClick={() => setTable(!table)}
        >
          {t(table ? "showChart" : "showData")}
        </button>
      </div>
      <div className="data-chart-legend" aria-label={t("series")}>
        {series.map((s) => (
          <button
            type="button"
            aria-pressed={!hidden.includes(s.key)}
            key={s.key}
            onClick={() =>
              setHidden((old) =>
                old.includes(s.key)
                  ? old.filter((k) => k !== s.key)
                  : old.length < series.length - 1
                    ? [...old, s.key]
                    : old,
              )
            }
          >
            <i style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <div className="enterprise-empty">
          <p>{t("noChartData")}</p>
        </div>
      ) : table ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t("category")}</th>
                {visible.map((s) => (
                  <th scope="col" className="numeric" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r.label}</th>
                  {visible.map((s) => (
                    <td className="numeric" key={s.key}>
                      {value(r.values[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="data-chart-plot">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              style={{ minWidth: rows.length > 8 ? width : undefined }}
              role="group"
              aria-labelledby={id}
            >
              {ticks.map((tick) => {
                return (
                  <g key={tick}>
                    <line
                      x1={left}
                      x2={width - right}
                      y1={y(tick)}
                      y2={y(tick)}
                      stroke="var(--line)"
                      strokeDasharray={tick === 0 ? undefined : "3 4"}
                    />
                    <text
                      x={left - 10}
                      y={y(tick) + 4}
                      textAnchor="end"
                      className="data-axis"
                    >
                      {axisFormat
                        ? axisFormat(tick)
                        : new Intl.NumberFormat(locale, {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(tick)}
                    </text>
                  </g>
                );
              })}
              {rows.map((row, i) => (
                <g
                  key={i}
                  tabIndex={0}
                  role="button"
                  aria-label={`${row.label}: ${visible.map((s) => `${s.label} ${value(row.values[s.key])}`).join(", ")}`}
                  onFocus={() => setActive(i)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(i);
                    }
                  }}
                >
                  <rect
                    x={left + i * band + 3}
                    y={16}
                    width={band - 6}
                    height={plotHeight + 8}
                    fill={active === i ? "var(--surface-soft)" : "transparent"}
                    rx={6}
                  />
                  {visible.map((s, j) => {
                    const n = row.values[s.key];
                    return typeof n === "number" && Number.isFinite(n) ? (
                      <rect
                        key={s.key}
                        x={
                          left +
                          i * band +
                          (band - visible.length * barW) / 2 +
                          j * barW
                        }
                        y={Math.min(y(n), y(0))}
                        width={Math.max(2, barW - 3)}
                        height={Math.max(
                          n === 0 ? 0 : 2,
                          Math.abs(y(n) - y(0)),
                        )}
                        rx={4}
                        fill={s.color}
                      >
                        <title>{`${row.label} · ${s.label}: ${value(n)}`}</title>
                      </rect>
                    ) : null;
                  })}
                  <text
                    x={left + (i + 0.5) * band}
                    y={height - 16}
                    textAnchor="middle"
                    className="data-axis"
                  >
                    {row.label.length > 17
                      ? row.label.slice(0, 16) + "…"
                      : row.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <div className="data-chart-inspect" aria-live="polite">
            {active !== null && rows[active] ? (
              <>
                <strong>{rows[active].label}</strong>
                {visible.map((s) => (
                  <span key={s.key}>
                    <i style={{ background: s.color }} />
                    {s.label}
                    <b>{value(rows[active].values[s.key])}</b>
                  </span>
                ))}
              </>
            ) : (
              <span>{t("inspectChart")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
