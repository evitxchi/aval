/**
 * How a figure is written, in one place.
 *
 * The WhatsApp channel is a second *view* of an answer the dashboard already
 * gives, and the acceptance test for it is that a figure read over WhatsApp
 * matches the dashboard exactly. That is a promise about formatting as much as
 * about the query: `$28,500.75` and `$28,501` are the same number and a
 * different answer to "how much did we collect", and an operator who sees one
 * on screen and the other on their phone has found a bug whether or not there
 * is one.
 *
 * Making it match by construction means one function, not two that agree
 * today. This is the dashboard's behaviour, lifted verbatim from
 * `app/components/aval-assistant.tsx`, which now calls it rather than keeping
 * its own copy.
 *
 * **Known divergence, deliberately left alone.** `lib/ask-aval/export.ts` has
 * a third implementation that rounds currency to whole units and pins the
 * locale to `en-US`, so a document export of the same answer already differs
 * from the screen. That predates this module and changing it would change
 * every generated PDF, DOCX, PPTX and XLSX — a call worth making on purpose
 * rather than as a side effect of shipping a messaging channel.
 */

export interface FormattableMetric {
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
}

/**
 * A metric's display value.
 *
 * A string value passes through untouched: the tool that produced it has
 * already decided how it reads, and reformatting would be this layer
 * overruling a decision made closer to the data.
 */
export function formatMetricValue(metric: FormattableMetric): string {
  if (typeof metric.value === "string") return metric.value;
  if (metric.unit === "currency") return `$${metric.value.toLocaleString()}`;
  if (metric.unit === "percent") return `${metric.value}%`;
  if (metric.unit === "days") return `${metric.value}d`;
  return metric.value.toLocaleString();
}

/** A period-over-period change, signed. */
export function formatMetricDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}
