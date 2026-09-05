/** A readable scale that always includes zero and encloses every value. */
export function chartDomain(values: number[]) {
  const finite = values.filter(Number.isFinite);
  let minimum = 0,
    maximum = 0;
  for (const value of finite) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum === maximum) maximum = 1;
  const target = (maximum - minimum) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const fraction = target / magnitude;
  const multiplier =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = Math.max(
    finite.every(Number.isInteger) ? 1 : Number.MIN_VALUE,
    multiplier * magnitude,
  );
  const bottom = Math.floor(minimum / step) * step;
  const top = Math.ceil(maximum / step) * step;
  const count = Math.round((top - bottom) / step);
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    Number((bottom + index * step).toPrecision(12)),
  );
  return { bottom, top, ticks };
}
