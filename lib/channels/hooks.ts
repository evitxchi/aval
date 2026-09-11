/**
 * The three hooks the brief specifies, as rules over the existing policy
 * engine rather than beside it.
 *
 * The brief asks for a `BeforeToolCall` chokepoint returning
 * `allow | confirm | block`. `lib/agents/policy.ts` already *is* that
 * chokepoint: it returns `allow | require_approval | deny`, it is already the
 * only thing that decides whether a tool call runs, and it already runs on the
 * dashboard. Building a second hook type would be the "second gate" the brief
 * explicitly forbids, and would produce the worst possible outcome — two gates
 * that agree today and drift apart later.
 *
 * So this module adds what the policy engine does not have and cannot get from
 * a static table: the *surface* a call came from, and a classifier for
 * situations no permission model can express. The naming is kept so the
 * mapping is legible to anyone reading the brief alongside the code:
 *
 *   roleGate        → the existing permission envelope, plus channel roles
 *   destructiveGuard→ never `allow` for anything touching money, calendar,
 *                     or a legal notice; `confirm` at minimum
 *   escalationGuard → `block` plus a human notification
 *
 * Hooks run in order and **any block wins**. That is not an implementation
 * detail: it means a later hook can never soften an earlier refusal, so adding
 * a hook can only ever make the system more restrictive.
 */

import { evaluate, type PolicyDecision, type PolicySubject } from "@/lib/agents/policy";
import { getTool } from "@/lib/agents/registry";
import { canConfirm, canPropose, type ChannelRole } from "./roles.ts";
import { classifyEscalation, type EscalationMatch } from "./escalation.ts";

export type HookDecision = "allow" | "confirm" | "block";

export interface HookContext {
  role: ChannelRole;
  organizationId: string;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  surface: "dashboard" | "whatsapp";
  /** The inbound text, for the escalation classifier only. Never reaches a permission decision. */
  messageText?: string;
  personaId?: string;
  isGuest?: boolean;
}

export interface HookResult {
  decision: HookDecision;
  /** Which hook decided, so a refusal can be explained and counted. */
  rule: string;
  reason: string;
  /** Set by escalationGuard: a person needs to be told. */
  escalation?: EscalationMatch;
}

type Hook = (context: HookContext) => HookResult;

/**
 * Tools whose effects reach money, a calendar, or a legal position.
 *
 * Matched on the tool's declared properties first — `financial`, `critical`
 * risk — and by name only as a backstop for categories the descriptor does not
 * model. Name matching alone would be fragile; descriptor matching alone would
 * miss a notice-sending tool that moves no money.
 */
const DESTRUCTIVE_NAME_PATTERN = /(payment|refund|charge|invoice|transfer|payout|disburse|notice|evict|terminate|lease|schedule|appointment|calendar|send_external_message|place_call|publish)/i;

/**
 * `roleGate` — does this role hold this tool at all.
 *
 * Delegates the permission question to `evaluate`, which reads the same static
 * envelope the dashboard uses, and adds the one thing the envelope cannot
 * know: that a resident is not a workspace member and may propose nothing.
 */
export const roleGate: Hook = (context) => {
  if (!canPropose(context.role)) {
    return { decision: "block", rule: "roleGate", reason: "This role cannot take actions." };
  }

  const subject: PolicySubject = {
    organizationId: context.organizationId,
    userId: context.userId,
    isGuest: context.isGuest ?? false,
  };
  const decision: PolicyDecision = evaluate(context.tool, context.args, subject, { personaId: context.personaId });

  if (decision.effect === "deny") {
    return { decision: "block", rule: "roleGate", reason: decision.reason };
  }
  if (decision.effect === "require_approval") {
    return { decision: "confirm", rule: "roleGate", reason: decision.reason };
  }
  return { decision: "allow", rule: "roleGate", reason: "Permitted by the workspace envelope." };
};

/**
 * `destructiveGuard` — anything touching money, a calendar, or a legal notice
 * returns `confirm`, **never** `allow`.
 *
 * Note what this hook does not do: it never blocks. Blocking every money tool
 * would make the write path useless; the point is that the operator sees what
 * is about to happen before it does. The invariant this exists to hold is
 * narrow and absolute — *no money-touching tool is ever auto-executed* — and a
 * test asserts it over the whole registry rather than over a list somebody
 * maintains by hand.
 */
export const destructiveGuard: Hook = (context) => {
  const tool = getTool(context.tool);
  const destructive =
    Boolean(tool?.financial) ||
    tool?.riskLevel === "critical" ||
    tool?.riskLevel === "high" ||
    DESTRUCTIVE_NAME_PATTERN.test(context.tool);

  if (!destructive) return { decision: "allow", rule: "destructiveGuard", reason: "No money, calendar, or legal effect." };

  return {
    decision: "confirm",
    rule: "destructiveGuard",
    reason: "This moves money, changes a schedule, or sends a notice. It needs confirming first.",
  };
};

/**
 * `escalationGuard` — legal, eviction, habitability, distressed tenant.
 *
 * Written before the happy path, as the brief instructs, because it is the
 * hook whose absence is invisible. Everything else fails loudly; this one
 * fails by an agent handling smoothly a message that should have reached a
 * person within the hour.
 *
 * It reads the **inbound text**, which is the one place untrusted content
 * legitimately influences a decision — and it can only ever push the decision
 * toward `block`. A message crafted to trip the classifier gets a human. A
 * message crafted to avoid it still faces every other hook. Neither direction
 * lets inbound text widen access, which is the property that matters.
 */
export const escalationGuard: Hook = (context) => {
  const match = classifyEscalation(context.messageText ?? "");
  if (!match) return { decision: "allow", rule: "escalationGuard", reason: "No escalation signal." };

  return {
    decision: "block",
    rule: "escalationGuard",
    reason: `This needs a person: ${match.category}.`,
    escalation: match,
  };
};

/** The order hooks run in. Escalation first, so its block short-circuits the rest. */
export const HOOKS: Hook[] = [escalationGuard, roleGate, destructiveGuard];

/**
 * Run every hook. Any `block` wins; otherwise any `confirm` wins; `allow` only
 * when every hook allowed.
 *
 * Deliberately runs all of them rather than short-circuiting on the first
 * non-allow, so the trace records every hook's opinion. A refusal you can only
 * see the first reason for is a refusal that takes an afternoon to debug.
 */
export function runHooks(context: HookContext): HookResult & { all: HookResult[] } {
  const results = HOOKS.map((hook) => hook(context));

  const blocked = results.find((result) => result.decision === "block");
  if (blocked) return { ...blocked, all: results };

  const confirm = results.find((result) => result.decision === "confirm");
  if (confirm) return { ...confirm, all: results };

  return { decision: "allow", rule: "all", reason: "Every hook allowed.", all: results };
}

/**
 * Whether this identity may confirm an action it proposed.
 *
 * Separate from the hooks because it is asked at a different moment — on the
 * button tap, not on the proposal. A coordinator may propose a rent increase
 * and may not be the one who approves it; routing the confirmation through the
 * same role check as the dashboard is what stops the channel becoming a
 * laxer second route to the same authority.
 */
export function mayConfirm(role: ChannelRole): boolean {
  return canConfirm(role);
}
