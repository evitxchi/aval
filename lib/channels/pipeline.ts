/**
 * What happens to an inbound message.
 *
 *   resolve identity → role gate → handleAskAval (read tools) → render → send
 *
 * Read that order as a series of cheaper-and-more-certain checks in front of
 * one expensive-and-uncertain one. Everything before `handleAskAval` is
 * deterministic and free; the model call is the last resort, not the first
 * move. Concretely, these all return before a single token is spent:
 *
 *   - an unparseable or unlinked number      (no relationship)
 *   - a link code                            (a state change, not a question)
 *   - `help` / `ayuda`                       (a fixed list)
 *   - `MORE`                                 (text we already have)
 *   - a button tap that resolves to an id    (a stored action, not a new one)
 *   - a resident                             (handed to a human)
 *
 * The brief's rule that inbound text cannot influence `org_id`, `role`, or a
 * hook decision is enforced structurally rather than by instruction: those
 * three are resolved here, before the model sees anything, and the model is
 * never handed an argument that could carry them.
 */

import { resolveInbound, type ChannelId, type InboundIdentity } from "./identity.ts";
import { consumeLinkCode, extractLinkCode } from "./linking.ts";
import { asChannelLocale, copy, exampleCommands, isHelpRequest, isMoreRequest, roleLabel, type ChannelLocale } from "./copy.ts";
import { defaultTerms, type TermMap } from "./vocabulary.ts";
import { questionForSuggestion, suggestionsFor } from "./suggestions.ts";
import { renderAnswer, renderPlain, type AskAnswer, type RenderedMessage } from "./whatsapp/render.ts";
import type { InboundChannelMessage } from "./registry.ts";
import {
  completionMessage,
  confirmButtons,
  parseActionPayload,
  previewText,
  type PendingAction,
  type RecipientPreview,
} from "./action-format.ts";
import { mayConfirm } from "./hooks.ts";

/**
 * What the pipeline decided, without having done it.
 *
 * Returning a decision rather than sending from inside the pipeline keeps this
 * module free of network calls, which is what makes the routing testable —
 * every branch above can be asserted without a WhatsApp account.
 */
export interface PipelineOutcome {
  /** The message to send, or null when there is deliberately no reply. */
  reply: RenderedMessage | null;
  /** Where it goes. Null when there is no reply. */
  to: string | null;
  /** Whether a model call happened. Asserted directly by tests. */
  modelCalled: boolean;
  /** Why this outcome, for the trace. Never sent to the recipient. */
  reason:
    | "unlinked"
    | "linked"
    | "link_failed"
    | "help"
    | "more"
    | "resident_handoff"
    | "answered"
    | "answer_failed"
    | "budget_exhausted"
    | "action_confirmed"
    | "action_cancelled"
    | "action_previewed"
    | "action_expired"
    | "action_refused"
    | "action_undone"
    | "ignored";
  /** Set when this turn produced overflow text a later MORE should return. */
  overflow?: string | null;
  identity?: InboundIdentity;
}

/** The side of the pipeline that needs a model and a database, injected so the routing can be tested without either. */
export interface PipelineDeps {
  /**
   * Runs Ask Aval and returns the parsed answer, or null if it could not
   * answer.
   *
   * `answer: null` with a `degraded` tier set is the spend-ceiling case: the
   * workspace is past its limit, no model ran, and the recipient is told so
   * rather than getting silence or an error.
   */
  ask(input: {
    question: string;
    identity: InboundIdentity;
    locale: ChannelLocale;
  }): Promise<{ answer: AskAnswer | null; toolsUsed: string[]; degraded?: string | null } | null>;
  /** The text left over from this thread's last truncated answer, if any. */
  readOverflow(channelIdentityId: string, organizationId: string): Promise<string | null>;
  /** The write path. Omitted in read-only deployments, in which case a confirmation is refused rather than guessed at. */
  actions?: ActionDeps;
  /** Per-org vocabulary. Defaults are used when this is omitted. */
  terms?(organizationId: string, locale: ChannelLocale): Promise<TermMap>;
}

/** The write path, injected so the routing above can be tested without a database. */
export interface ActionDeps {
  load(id: string, channelIdentityId: string): Promise<PendingAction | null>;
  claim(id: string, channelIdentityId: string): Promise<boolean>;
  cancel(id: string, channelIdentityId: string): Promise<boolean>;
  drop(id: string, channelIdentityId: string, index: number): Promise<RecipientPreview[] | null>;
  /** Runs the claimed action. Returns whether the effect can be undone. */
  execute(action: PendingAction): Promise<{ ok: boolean; reversible: boolean }>;
  undo(organizationId: string, actionId: string): Promise<{ outcome: string }>;
}

/**
 * Resolve a tap on an action button.
 *
 * Every branch re-loads the action bound to *this* identity rather than
 * trusting the id in the payload. A button lives in a message, a message can
 * be forwarded, and a forwarded button must be inert in anyone else's hands.
 */
async function resolveAction(
  action: { intent: "confirm" | "cancel" | "list" | "drop" | "undo"; id: string; index?: number },
  identity: InboundIdentity,
  locale: ChannelLocale,
  from: string,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const plain = (
    text: string,
    reason: PipelineOutcome["reason"],
    buttons: Parameters<typeof renderPlain>[1] = [],
  ): PipelineOutcome => ({
    reply: renderPlain(text, buttons, locale),
    to: from,
    modelCalled: false,
    reason,
    identity,
  });

  // Without a write path wired, a confirmation is refused rather than guessed
  // at. Silently doing nothing would leave the operator believing something
  // happened.
  if (!deps.actions) return plain(copy(locale, "confirmExpired"), "action_refused");

  if (action.intent === "undo") {
    const result = await deps.actions.undo(identity.organizationId, action.id);
    if (result.outcome === "reverted") return plain(copy(locale, "undoDone"), "action_undone");
    if (result.outcome === "expired") return plain(copy(locale, "undoExpired"), "action_expired");
    return plain(copy(locale, "actionIrreversible"), "action_refused");
  }

  const pending = await deps.actions.load(action.id, identity.channelIdentityId);
  // Expired, already resolved, or never this identity's — all the same reply,
  // because from the outside they are the same situation, and distinguishing
  // them would confirm that someone else's action id exists.
  if (!pending) return plain(copy(locale, "confirmExpired"), "action_expired");

  if (action.intent === "cancel") {
    await deps.actions.cancel(action.id, identity.channelIdentityId);
    return plain(copy(locale, "actionCancelled"), "action_cancelled");
  }

  if (action.intent === "list") {
    return plain(
      previewText(pending, locale),
      "action_previewed",
      confirmButtons(pending.id, pending.recipients.length, locale),
    );
  }

  if (action.intent === "drop") {
    const remaining = await deps.actions.drop(action.id, identity.channelIdentityId, action.index ?? -1);
    if (!remaining) return plain(copy(locale, "confirmExpired"), "action_expired");
    return plain(
      previewText({ ...pending, recipients: remaining }, locale),
      "action_previewed",
      confirmButtons(pending.id, remaining.length, locale),
    );
  }

  // Confirming. Separation of duties is re-checked here, not only at proposal
  // time: a coordinator may ask for a thing to happen and may not be the one
  // who says yes.
  if (!mayConfirm(identity.role)) return plain(copy(locale, "confirmNotPermitted"), "action_refused");

  // The claim is a compare-and-set, so two taps on the same button — which
  // happens, because a slow reply looks like a failed one — execute once.
  if (!(await deps.actions.claim(action.id, identity.channelIdentityId))) {
    return plain(copy(locale, "confirmExpired"), "action_expired");
  }

  const executed = await deps.actions.execute(pending);
  if (!executed.ok) return plain(copy(locale, "unavailable"), "action_refused");

  const completion = completionMessage(executed.reversible, pending.id, locale);
  return plain(completion.text, "action_confirmed", completion.buttons);
}

/**
 * Route one verified inbound message.
 *
 * `message` has been through HMAC verification and parsing. Its `body` and
 * `displayName` are still untrusted text and are treated as data everywhere
 * below — matched against fixed patterns, or passed to the model as a
 * question, never concatenated into an instruction.
 */
export async function handleInbound(message: InboundChannelMessage, deps: PipelineDeps): Promise<PipelineOutcome> {
  const channel = message.channel as ChannelId;

  // 1. A link attempt is a state change, not a question. Checked before
  //    identity resolution, because the whole point is that the sender does
  //    not have one yet.
  const code = extractLinkCode(message.body);
  if (code) return linkOutcome(code, message, channel);

  // 2. Identity. Null means no relationship, and the reply is canned.
  const identity = await resolveInbound(message.from, channel);
  if (!identity) {
    return {
      reply: renderPlain(copy("en", "unlinked")),
      to: message.from,
      modelCalled: false,
      reason: "unlinked",
    };
  }

  const locale = asChannelLocale(identity.locale);
  const terms = deps.terms ? await deps.terms(identity.organizationId, locale) : defaultTerms(locale);

  // 3. A resident never reaches a model. Their tool set is empty by design
  //    (lib/channels/roles.ts): every read tool aggregates across the
  //    portfolio, so answering "what do I owe" would answer with what the
  //    building owes.
  if (identity.role === "resident") {
    return {
      reply: renderPlain(copy(locale, "residentHandoff"), [], locale),
      to: message.from,
      modelCalled: false,
      reason: "resident_handoff",
      identity,
    };
  }

  // 4. Help is a fixed list. It must never cost a model call, because it is
  //    the message a confused user sends repeatedly.
  if (isHelpRequest(message.body)) {
    return {
      reply: renderPlain(helpText(locale, identity.role), suggestionsFor({ role: identity.role, locale }), locale),
      to: message.from,
      modelCalled: false,
      reason: "help",
      identity,
    };
  }

  // 5. MORE returns text we already have.
  if (isMoreRequest(message.body) || message.buttonPayload === "more") {
    const overflow = await deps.readOverflow(identity.channelIdentityId, identity.organizationId);
    if (overflow) {
      const rendered = renderPlain(overflow, suggestionsFor({ role: identity.role, locale }), locale);
      return { reply: rendered, to: message.from, modelCalled: false, reason: "more", overflow: rendered.overflow, identity };
    }
    // Nothing held. Fall through and treat it as an ordinary question rather
    // than replying "nothing to show", which is confusing when the user has
    // scrolled past the answer they were continuing.
  }

  // 6. A button tap resolves to a question we wrote. An unrecognised payload
  //    is dropped rather than interpreted — it arrived over the network, and
  //    the ids are ours.
  let question = message.body;
  if (message.buttonPayload) {
    if (message.buttonPayload === "help") {
      return {
        reply: renderPlain(helpText(locale, identity.role), suggestionsFor({ role: identity.role, locale }), locale),
        to: message.from,
        modelCalled: false,
        reason: "help",
        identity,
      };
    }
    const mapped = questionForSuggestion(message.buttonPayload, locale);
    if (mapped) question = mapped;
    else {
      const action = parseActionPayload(message.buttonPayload);
      // An action payload that parses is resolved here; one that does not is
      // dropped without comment. The ids are ours, so an id we do not
      // recognise is not a request, it is noise or an attempt.
      if (action) return resolveAction(action, identity, locale, message.from, deps);
      return { reply: null, to: null, modelCalled: false, reason: "ignored", identity };
    }
  }

  if (!question.trim()) return { reply: null, to: null, modelCalled: false, reason: "ignored", identity };

  // 7. Only now does a model run, with the tool set the role already selected.
  const result = await deps.ask({ question, identity, locale });

  // Past the spend ceiling: no model ran, and the reply says why and how to
  // lift it. Silently going dark and silently exceeding budget are both worse
  // than a visible downgrade.
  if (result && !result.answer) {
    return {
      reply: renderPlain(copy(locale, "budgetExhausted"), [], locale),
      to: message.from,
      modelCalled: false,
      reason: "budget_exhausted",
      identity,
    };
  }

  if (!result || !result.answer) {
    return {
      reply: renderPlain(copy(locale, "unavailable"), suggestionsFor({ role: identity.role, locale }), locale),
      to: message.from,
      modelCalled: true,
      reason: "answer_failed",
      identity,
    };
  }

  const rendered = renderAnswer({
    answer: result.answer,
    locale,
    terms,
    suggestions: suggestionsFor({ role: identity.role, locale, toolsUsed: result.toolsUsed }),
  });

  // A degraded answer says so. The operator seeing a shorter reply with no
  // explanation would read it as the agent getting worse, not as a budget
  // they can raise.
  const body = result.degraded ? `${rendered.body}\n\n${copy(locale, "degraded")}` : rendered.body;

  return {
    reply: { ...rendered, body },
    to: message.from,
    modelCalled: true,
    reason: "answered",
    overflow: rendered.overflow,
    identity,
  };
}

async function linkOutcome(code: string, message: InboundChannelMessage, channel: ChannelId): Promise<PipelineOutcome> {
  const outcome = await consumeLinkCode({ code, phone: message.from, channel });
  if (outcome.status === "linked") {
    const locale = asChannelLocale(outcome.locale);
    const confirmation = copy(locale, "linkConfirmed", {
      org: outcome.organizationName,
      role: roleLabel(locale, outcome.role),
    });
    const welcome = copy(locale, "welcome", {
      examples: exampleCommands(locale, outcome.role)
        .map((example) => `• ${example}`)
        .join("\n"),
    });
    return {
      reply: renderPlain(`${confirmation}\n\n${welcome}`, suggestionsFor({ role: outcome.role, locale }), locale),
      to: message.from,
      modelCalled: false,
      reason: "linked",
    };
  }

  // A refused code gets a plain refusal in English: we have no identity, so we
  // have no locale, and guessing one from the number's country code would be a
  // guess about a person made from their phone number.
  const key = (
    {
      expired: "linkExpired",
      consumed: "linkConsumed",
      unknown_code: "linkUnknown",
      invalid_number: "linkUnknown",
      already_linked_elsewhere: "linkElsewhere",
    } as const
  )[outcome.status];
  return { reply: renderPlain(copy("en", key)), to: message.from, modelCalled: false, reason: "link_failed" };
}

/** The help text: the same five examples the welcome message used, filtered by role. */
export function helpText(locale: ChannelLocale, role: string): string {
  const examples = exampleCommands(locale, role)
    .map((example) => `• ${example}`)
    .join("\n");
  return `*${copy(locale, "helpHeader")}*\n\n${examples}`;
}
