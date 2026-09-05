export type ChartKind =
  | "bars"
  | "horizontal"
  | "dots"
  | "stacked"
  | "line"
  | "area"
  | "steps"
  | "stackedArea";
export interface Datum {
  label: string;
  values: Record<string, number | null>;
}
export const finiteValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
/** Only additive, complete, non-negative observations can become parts of a total. */
export function chartKinds(
  rows: Datum[],
  keys: string[],
  temporal: boolean,
  additive: boolean,
): ChartKind[] {
  const kinds: ChartKind[] = ["bars", "horizontal", "dots"];
  if (temporal) kinds.push("line", "area", "steps");
  if (
    additive &&
    keys.length > 1 &&
    rows.every((row) =>
      keys.every(
        (key) => finiteValue(row.values[key]) && row.values[key]! >= 0,
      ),
    )
  ) {
    kinds.push("stacked");
    if (temporal) kinds.push("stackedArea");
  }
  return kinds;
}
/** Gaps remain gaps. Never interpolate across unknown observations. */
export function segments(
  values: (number | null | undefined)[],
): { index: number; value: number }[][] {
  const result: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (finiteValue(value)) current.push({ index, value });
    else if (current.length) {
      result.push(current);
      current = [];
    }
  });
  if (current.length) result.push(current);
  return result;
}
/** Dot density is a continuous fill inside an exact-value silhouette, not a rounded count. */
export function totals(rows: Datum[], keys: string[]) {
  return rows.map((row) =>
    keys.reduce(
      (sum, key) => sum + (finiteValue(row.values[key]) ? row.values[key]! : 0),
      0,
    ),
  );
}
