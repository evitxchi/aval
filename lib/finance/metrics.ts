/**
 * Real-estate financial formulas — NOI, cap rate, DSCR, cash-on-cash, GRM,
 * NPV/IRR, and mortgage amortization.
 *
 * Deliberately hand-written rather than pulled from a dependency: a GitHub
 * sourcing pass for this category (see docs/DECISIONS.md) found nothing
 * beyond single-maintainer, sub-10-star repos for real-estate-specific
 * finance. These are standard, well-published formulas; owning them here
 * means no dependency risk and answers that match Aval's own rounding and
 * percentage conventions (a plain number like `6.5` for 6.5%, matching
 * `app/data/sample.ts`'s `derive*Pct` helpers — never a `0.065` fraction).
 */

/** NOI = effective gross income − operating expenses (both annual, excluding debt service and capex). */
export function netOperatingIncome(effectiveGrossIncome: number, operatingExpenses: number): number {
  return effectiveGrossIncome - operatingExpenses;
}

/** Cap rate, as a percent: how much of the purchase price the property's NOI returns in a year, ignoring financing. */
export function capRatePct(noi: number, propertyValue: number): number {
  if (propertyValue <= 0) throw new Error("capRatePct: propertyValue must be positive");
  return (noi / propertyValue) * 100;
}

/** Cash-on-cash return, as a percent: annual pre-tax cash flow (after debt service) over the actual cash invested (down payment + closing + rehab). */
export function cashOnCashReturnPct(annualPreTaxCashFlow: number, totalCashInvested: number): number {
  if (totalCashInvested <= 0) throw new Error("cashOnCashReturnPct: totalCashInvested must be positive");
  return (annualPreTaxCashFlow / totalCashInvested) * 100;
}

/** DSCR: how many times over NOI covers the annual debt service. Expressed as a ratio (1.25), not a percent — lenders quote it that way. */
export function debtServiceCoverageRatio(noi: number, annualDebtService: number): number {
  if (annualDebtService <= 0) throw new Error("debtServiceCoverageRatio: annualDebtService must be positive");
  return noi / annualDebtService;
}

/** Share of effective gross income consumed by operating expenses. Lower is better; excludes debt service by definition. */
export function operatingExpenseRatioPct(operatingExpenses: number, effectiveGrossIncome: number): number {
  if (effectiveGrossIncome <= 0) throw new Error("operatingExpenseRatioPct: effectiveGrossIncome must be positive");
  return (operatingExpenses / effectiveGrossIncome) * 100;
}

/** Occupancy a property must sustain just to cover operating expenses and debt service, against its fully-occupied gross potential income. */
export function breakEvenOccupancyPct(operatingExpenses: number, annualDebtService: number, grossPotentialIncome: number): number {
  if (grossPotentialIncome <= 0) throw new Error("breakEvenOccupancyPct: grossPotentialIncome must be positive");
  return ((operatingExpenses + annualDebtService) / grossPotentialIncome) * 100;
}

/** Gross rent multiplier: price paid per dollar of annual gross rent. Lower means the price is cheap relative to rent it produces. */
export function grossRentMultiplier(propertyValue: number, annualGrossRent: number): number {
  if (annualGrossRent <= 0) throw new Error("grossRentMultiplier: annualGrossRent must be positive");
  return propertyValue / annualGrossRent;
}

/** NPV of `cashFlows` (index 0 = today, typically the negative initial outlay) at `discountRatePct` per period. */
export function netPresentValue(discountRatePct: number, cashFlows: number[]): number {
  const rate = discountRatePct / 100;
  return cashFlows.reduce((total, flow, period) => total + flow / (1 + rate) ** period, 0);
}

const IRR_MAX_ITERATIONS = 100;
const IRR_TOLERANCE = 1e-7;

/**
 * IRR, as a percent, via Newton-Raphson on NPV(rate) = 0 starting from
 * `guessPct`, falling back to bisection over [-99%, 1000%] if Newton fails
 * to converge (flat or oscillating derivative near certain cash-flow
 * shapes). Throws if neither converges — callers should treat that as "no
 * real solution for this cash-flow shape" rather than return a misleading
 * number.
 */
export function internalRateOfReturnPct(cashFlows: number[], guessPct = 10): number {
  if (cashFlows.length < 2) throw new Error("internalRateOfReturnPct: needs at least two cash flows");
  if (!cashFlows.some((flow) => flow < 0) || !cashFlows.some((flow) => flow > 0)) {
    throw new Error("internalRateOfReturnPct: cash flows must include at least one negative and one positive value");
  }

  const npvAt = (ratePct: number) => netPresentValue(ratePct, cashFlows);
  const derivativeAt = (ratePct: number) => {
    const rate = ratePct / 100;
    return cashFlows.reduce((total, flow, period) => (period === 0 ? total : total - (period * flow) / (1 + rate) ** (period + 1)), 0);
  };

  let ratePct = guessPct;
  for (let i = 0; i < IRR_MAX_ITERATIONS; i++) {
    const npv = npvAt(ratePct);
    if (Math.abs(npv) < IRR_TOLERANCE) return ratePct;
    const derivative = derivativeAt(ratePct);
    if (Math.abs(derivative) < IRR_TOLERANCE) break;
    ratePct = ratePct - npv / (derivative / 100);
  }

  let low = -99;
  let high = 1000;
  if (Math.sign(npvAt(low)) === Math.sign(npvAt(high))) {
    throw new Error("internalRateOfReturnPct: no sign change found in [-99%, 1000%]; cash-flow shape has no real IRR in range");
  }
  for (let i = 0; i < IRR_MAX_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const npvMid = npvAt(mid);
    if (Math.abs(npvMid) < IRR_TOLERANCE) return mid;
    if (Math.sign(npvMid) === Math.sign(npvAt(low))) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export interface AmortizationRow {
  month: number;
  payment: number;
  principalPaid: number;
  interestPaid: number;
  balance: number;
}

/** Standard fixed-rate fully-amortizing mortgage payment. */
export function monthlyMortgagePayment(principal: number, annualInterestRatePct: number, termMonths: number): number {
  const monthlyRate = annualInterestRatePct / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -termMonths);
}

/** Full month-by-month amortization schedule for a fixed-rate loan. */
export function amortizationSchedule(principal: number, annualInterestRatePct: number, termMonths: number): AmortizationRow[] {
  const payment = monthlyMortgagePayment(principal, annualInterestRatePct, termMonths);
  const monthlyRate = annualInterestRatePct / 100 / 12;
  const rows: AmortizationRow[] = [];
  let balance = principal;
  for (let month = 1; month <= termMonths; month++) {
    const interestPaid = balance * monthlyRate;
    const principalPaid = Math.min(payment - interestPaid, balance);
    balance = Math.max(0, balance - principalPaid);
    rows.push({ month, payment, principalPaid, interestPaid, balance });
  }
  return rows;
}
