/**
 * Strips em dashes (and en dashes used the same way) from generated text as
 * a safety net behind the system prompt's explicit instruction not to use
 * them. Models default to dashes heavily regardless of instructions, so
 * this catches what slips through rather than relying on the prompt alone.
 * Runs before the faithfulness gate, so it never touches numerals.
 */
export function stripDashes<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/,\s*,/g, ",")
      .replace(/,(\s*[.!?])/g, "$1")
      .replace(/^\s*,\s*/, "")
      .replace(/,\s*$/, "") as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => stripDashes(item)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripDashes(entry)])) as unknown as T;
  }
  return value;
}
