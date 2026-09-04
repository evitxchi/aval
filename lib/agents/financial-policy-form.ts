export function dollarsToCents(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function centsToDollars(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  return (cents / 100).toFixed(2);
}

export function parseCurrencies(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

export function parseAccountIds(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((account) => account.trim()).filter(Boolean))];
}
