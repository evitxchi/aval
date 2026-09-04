/**
 * Deterministic financial controls (§11 of the production-readiness guide).
 *
 * No tool in this app moves money yet. This module exists anyway, and that is
 * the point: the guide's §31 says financial actions must be "deterministic
 * backend operations initiated by agent proposals". Building the envelope
 * while the tool surface is still read-only means the first payment tool
 * lands inside a validated, thresholded, idempotent path instead of beside
 * one — and every check here can be tested today against synthetic proposals.
 *
 * Nothing in this file is reachable from a model. It receives a parsed
 * proposal and returns a verdict; it never calls a payment API, and the
 * executor refuses to run any tool whose descriptor is `unimplemented`.
 */

import type { ToolDescriptor } from "./registry.ts";

/**
 * Approval thresholds in minor units (cents).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE ARE PLACEHOLDER DEFAULTS, taken from §11's illustrative example.
 * The guide is explicit that real thresholds "should be designed around
 * Aval's use case, user roles, legal requirements, and financial partners" —
 * none of which are decided yet. They are deliberately conservative: the
 * `AUTOMATIC` band is zero, so *every* amount currently requires approval.
 * Raising it is a business decision, not a code cleanup.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface FinancialPolicy {
  status: "draft" | "approved" | "suspended";
  /** At or below this amount one independent approver is required. */
  singleApprovalMaxCents: number;
  /** Nothing above this executes through an agent, regardless of approvals. */
  hardCeilingCents: number;
  /** Aggregate ceiling across reserved, unknown, submitted and settled operations in a rolling 24 hours. */
  dailyLimitCents: number;
  allowedCurrencies: readonly string[];
  allowedAccountFingerprints: readonly string[];
  version: number;
}

/**
 * Fail-closed defaults. They preserve the old illustrative limits for tests
 * and UI copy, but `status: draft` means no financial proposal can execute
 * until a workspace owner explicitly approves a policy record.
 */
export const DEFAULT_FINANCIAL_POLICY: FinancialPolicy = {
  status: "draft",
  singleApprovalMaxCents: 50_000,
  hardCeilingCents: 2_500_000,
  dailyLimitCents: 5_000_000,
  allowedCurrencies: ["USD"],
  allowedAccountFingerprints: [],
  version: 1,
};

/** Compatibility names used by the existing tests and approval UI. */
export const APPROVAL_THRESHOLDS = {
  AUTOMATIC_MAX_CENTS: 0,
  ELEVATED_MIN_CENTS: DEFAULT_FINANCIAL_POLICY.singleApprovalMaxCents,
  HARD_CEILING_CENTS: DEFAULT_FINANCIAL_POLICY.hardCeilingCents,
} as const;
export const DAILY_ORG_LIMIT_CENTS = DEFAULT_FINANCIAL_POLICY.dailyLimitCents;

export type ApprovalTier = "automatic" | "single_approver" | "elevated_approver" | "refused";

/** Which approval a given amount attracts. Pure and total: every amount maps to a tier. */
export function approvalTierFor(amountCents: number, policy: FinancialPolicy = DEFAULT_FINANCIAL_POLICY): ApprovalTier {
  if (!Number.isFinite(amountCents) || amountCents < 0) return "refused";
  if (amountCents === 0 || amountCents > policy.hardCeilingCents) return "refused";
  if (amountCents > policy.singleApprovalMaxCents) return "elevated_approver";
  // There is deliberately no automatic financial band. "automatic" remains
  // in the type only for backwards-compatible rendering of historical rows.
  return "single_approver";
}

/**
 * Validates the money-shaped arguments of a proposal, before any threshold is
 * consulted. Returns a human-readable problem, or null when the arguments are
 * well-formed.
 *
 * Every check here treats the argument as hostile input, because it is: the
 * values arrive as JSON the model produced, possibly after reading a document
 * an outside party wrote.
 */
export function validateFinancialArguments(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
  policy: FinancialPolicy = DEFAULT_FINANCIAL_POLICY,
): string | null {
  const rules = tool.financial;
  if (!rules) return null;

  const rawAmount = args[rules.amountField];
  if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount)) {
    return `"${rules.amountField}" must be a finite number of minor units.`;
  }
  // Minor units are integers by definition. A fractional cent is either a
  // scale error (dollars sent where cents were expected) or a rounding
  // artifact, and both are worth refusing rather than silently rounding.
  if (!Number.isInteger(rawAmount)) return `"${rules.amountField}" must be a whole number of minor units (cents), not ${rawAmount}.`;
  if (rawAmount <= 0) return `"${rules.amountField}" must be greater than zero.`;
  if (rawAmount > policy.hardCeilingCents) {
    return `Amount ${rawAmount} exceeds the agent hard ceiling of ${policy.hardCeilingCents} minor units.`;
  }

  const currency = args[rules.currencyField];
  const allowedCurrencies = rules.allowedCurrencies.filter((code) => policy.allowedCurrencies.includes(code));
  if (typeof currency !== "string" || !allowedCurrencies.includes(currency)) {
    return `"${rules.currencyField}" must be one of ${allowedCurrencies.join(", ") || "the workspace-approved currencies"}.`;
  }

  const account = args[rules.accountField];
  if (typeof account !== "string" || account.trim().length < 2 || account.length > 200) {
    return `"${rules.accountField}" must identify a valid approved destination.`;
  }

  return null;
}

/**
 * The idempotency key for one financial step (§11's `transfer:task_283:step_4`).
 *
 * Derived only from task identity and step position — never from a timestamp,
 * a random value, or anything the model chose. That is what makes a retry
 * after a timeout collapse onto the original operation instead of creating a
 * second one: the retried step recomputes the identical key.
 */
export function idempotencyKey(taskId: string, stepIndex: number, toolName: string): string {
  return `${toolName}:${taskId}:step_${stepIndex}`;
}

export interface SpendCheck {
  ok: boolean;
  reason?: string;
}

/** Would this amount breach the org's rolling daily ceiling, given what it has already committed? */
export function withinDailyLimit(
  alreadyCommittedCents: number,
  proposedCents: number,
  dailyLimitCents = DAILY_ORG_LIMIT_CENTS,
): SpendCheck {
  const total = alreadyCommittedCents + proposedCents;
  if (total > dailyLimitCents) {
    return { ok: false, reason: `This would bring today's agent-initiated spend to ${total} minor units, over the ${dailyLimitCents} daily limit.` };
  }
  return { ok: true };
}

export function requiredApprovalsFor(tier: ApprovalTier): number {
  if (tier === "elevated_approver") return 2;
  if (tier === "single_approver") return 1;
  return 0;
}

export function validatePolicy(policy: Omit<FinancialPolicy, "status" | "version" | "allowedAccountFingerprints">): string | null {
  const amounts = [policy.singleApprovalMaxCents, policy.hardCeilingCents, policy.dailyLimitCents];
  if (amounts.some((value) => !Number.isSafeInteger(value) || value <= 0)) return "All financial limits must be positive whole minor-unit amounts.";
  if (policy.singleApprovalMaxCents > policy.hardCeilingCents) return "The single-approval ceiling cannot exceed the hard ceiling.";
  if (policy.dailyLimitCents < policy.singleApprovalMaxCents) return "The daily limit cannot be lower than the single-approval ceiling.";
  if (policy.hardCeilingCents > 100_000_000 || policy.dailyLimitCents > 500_000_000) return "The requested limits exceed Aval's absolute safety ceiling.";
  if (policy.allowedCurrencies.length === 0 || policy.allowedCurrencies.some((code) => !/^[A-Z]{3}$/.test(code))) return "At least one uppercase ISO-4217 currency code is required.";
  return null;
}
