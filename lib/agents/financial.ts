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
export const APPROVAL_THRESHOLDS = {
  /** At or below this, a policy check alone may authorize. Zero means: never. */
  AUTOMATIC_MAX_CENTS: 0,
  /** Above this, one approver is not enough — a second, more senior approval is required. */
  ELEVATED_MIN_CENTS: 50_000,
  /** Nothing above this executes through an agent at all, approved or not. */
  HARD_CEILING_CENTS: 2_500_000,
} as const;

/** Per-organization spend ceiling across all agent-initiated financial actions in a rolling 24 hours. */
export const DAILY_ORG_LIMIT_CENTS = 5_000_000;

export type ApprovalTier = "automatic" | "single_approver" | "elevated_approver" | "refused";

/** Which approval a given amount attracts. Pure and total: every amount maps to a tier. */
export function approvalTierFor(amountCents: number): ApprovalTier {
  if (!Number.isFinite(amountCents) || amountCents < 0) return "refused";
  if (amountCents > APPROVAL_THRESHOLDS.HARD_CEILING_CENTS) return "refused";
  if (amountCents > APPROVAL_THRESHOLDS.ELEVATED_MIN_CENTS) return "elevated_approver";
  if (amountCents > APPROVAL_THRESHOLDS.AUTOMATIC_MAX_CENTS) return "single_approver";
  return "automatic";
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
export function validateFinancialArguments(tool: ToolDescriptor, args: Record<string, unknown>): string | null {
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
  if (rawAmount > APPROVAL_THRESHOLDS.HARD_CEILING_CENTS) {
    return `Amount ${rawAmount} exceeds the agent hard ceiling of ${APPROVAL_THRESHOLDS.HARD_CEILING_CENTS} minor units.`;
  }

  const currency = args[rules.currencyField];
  if (typeof currency !== "string" || !rules.allowedCurrencies.includes(currency)) {
    return `"${rules.currencyField}" must be one of ${rules.allowedCurrencies.join(", ")}.`;
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
export function withinDailyLimit(alreadyCommittedCents: number, proposedCents: number): SpendCheck {
  const total = alreadyCommittedCents + proposedCents;
  if (total > DAILY_ORG_LIMIT_CENTS) {
    return { ok: false, reason: `This would bring today's agent-initiated spend to ${total} minor units, over the ${DAILY_ORG_LIMIT_CENTS} daily limit.` };
  }
  return { ok: true };
}
