export type UtilityType = "electricity" | "water" | "gas";

export type UnitOfMeasure = "kWh" | "gal" | "ccf" | "therm" | "m3";

export const UNIT_OF_MEASURE_BY_UTILITY: Record<UtilityType, UnitOfMeasure> = {
  electricity: "kWh",
  water: "gal",
  gas: "therm",
};

export interface UtilityBillInput {
  meterId: string;
  periodStart: Date;
  periodEnd: Date;
  usageAmount: number;
  costCents: number;
  currency: "USD" | "MXN";
}
