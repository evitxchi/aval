/**
 * Money arithmetic and formatting, backed by dinero.js v2.
 *
 * Every amount in this module is an integer count of minor units (cents),
 * matching how money is already stored elsewhere (e.g. `tokenPacks`'
 * `priceUsdCents`) — never a float dollar amount, which avoids the rounding
 * drift float arithmetic introduces once amounts are added, split, or
 * allocated across units.
 *
 * Scoped to Aval's two supported markets (see docs/DECISIONS.md, "Target
 * market: both US and LatAm"). dinero.js ships every ISO 4217 currency, but
 * only USD and MXN are exposed here — widen `SupportedCurrency` if a market
 * is added.
 */
import { add, allocate, dinero, greaterThanOrEqual, MXN, subtract, toDecimal, USD, type Dinero } from "dinero.js";

export type SupportedCurrency = "USD" | "MXN";

const CURRENCY_BY_CODE = { USD, MXN } as const;

const SYMBOL_BY_CODE: Record<SupportedCurrency, string> = {
  USD: "$",
  MXN: "MX$",
};

export type Money = Dinero<number>;

export function toMoney(amountCents: number, currency: SupportedCurrency): Money {
  return dinero({ amount: Math.round(amountCents), currency: CURRENCY_BY_CODE[currency] });
}

/** Sum of `amountCents` for money values, thrown on mixed currencies rather than silently coercing one. */
export function sumMoney(amounts: { amountCents: number; currency: SupportedCurrency }[], currency: SupportedCurrency): Money {
  const mismatched = amounts.find((entry) => entry.currency !== currency);
  if (mismatched) {
    throw new Error(`sumMoney: expected every amount in ${currency}, found ${mismatched.currency}`);
  }
  return amounts.reduce((total, entry) => add(total, toMoney(entry.amountCents, currency)), toMoney(0, currency));
}

export function subtractMoney(a: Money, b: Money): Money {
  return subtract(a, b);
}

export function isMoneyAtLeast(a: Money, b: Money): boolean {
  return greaterThanOrEqual(a, b);
}

/** Split `total` into `weights.length` shares proportional to `weights`, remainder distributed to the largest shares — dinero's `allocate`, not a hand-rolled percentage split that can lose or duplicate a cent. */
export function allocateMoney(total: Money, weights: number[]): Money[] {
  return allocate(total, weights);
}

export function moneyToDecimal(money: Money): string {
  return toDecimal(money);
}

/** e.g. formatMoney(123456, "USD") -> "$1,234.56"; formatMoney(123456, "MXN", "es-MX") -> "MX$1,234.56" */
export function formatMoney(amountCents: number, currency: SupportedCurrency, locale = "en-US"): string {
  const money = toMoney(amountCents, currency);
  const decimalValue = Number(toDecimal(money));
  const formattedNumber = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(decimalValue);
  return `${SYMBOL_BY_CODE[currency]}${formattedNumber}`;
}

export function decimalToCents(decimalAmount: number): number {
  return Math.round(decimalAmount * 100);
}
