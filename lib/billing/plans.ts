/**
 * Plan and top-up pack definitions, in code rather than the database: a
 * price or allowance change is a code review, not a migration. Stripe
 * prices are built inline at checkout time (price_data) from these numbers,
 * so nothing needs to be pre-created in the Stripe dashboard first.
 */

export interface Plan {
  id: string;
  name: string;
  priceUsdCents: number;
  monthlyTokenAllowance: number;
  /**
   * Marks the plan the pricing card highlights. Declared here rather than
   * inferred in the view (e.g. "the middle one") so that highlighting a plan
   * stays a deliberate product decision recorded in one place, and so
   * reordering or adding a tier can't silently move the badge.
   */
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", priceUsdCents: 0, monthlyTokenAllowance: 100_000 },
  { id: "growth", name: "Growth", priceUsdCents: 2900, monthlyTokenAllowance: 1_000_000, recommended: true },
  { id: "scale", name: "Scale", priceUsdCents: 9900, monthlyTokenAllowance: 5_000_000 },
];

export const DEFAULT_PLAN_ID = "starter";

export function getPlan(planId: string): Plan {
  return PLANS.find((plan) => plan.id === planId) ?? PLANS.find((plan) => plan.id === DEFAULT_PLAN_ID)!;
}

export interface TokenPack {
  id: string;
  name: string;
  priceUsdCents: number;
  tokens: number;
}

export const TOKEN_PACKS: TokenPack[] = [
  { id: "pack_small", name: "250,000 tokens", priceUsdCents: 1000, tokens: 250_000 },
  { id: "pack_large", name: "1,000,000 tokens", priceUsdCents: 3500, tokens: 1_000_000 },
];

export function getTokenPack(packId: string): TokenPack | null {
  return TOKEN_PACKS.find((pack) => pack.id === packId) ?? null;
}
