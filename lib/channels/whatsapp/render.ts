/**
 * A second view of the existing answer, not a second answer.
 *
 * Everything here is presentation over the `render_answer` JSON that
 * `handleAskAval` already produced. Nothing is computed, nothing is
 * summarised, no figure is derived — if a number is not in the answer object
 * it does not appear in the message. A renderer that did arithmetic would be a
 * second place for a figure to be wrong, and the faithfulness gate upstream
 * (`lib/ask-aval/faithfulness.ts`) would not be watching it.
 *
 * WhatsApp's formatting vocabulary is *bold* and _italic_ and essentially
 * nothing else — no headings, no tables, no links that render as anything but
 * their URL. So the layout carries the structure: a bold headline, then
 * figures one per line, then the narrative, then evidence. Markdown that
 * arrives in the answer text is stripped rather than passed through, because
 * `**bold**` renders on a phone as literal asterisks.
 */

import { formatMetricValue, formatMetricDelta, type FormattableMetric } from "../../ask-aval/format-metric.ts";
import { copy, type ChannelLocale } from "../copy.ts";
import { applyTerms, type TermMap } from "../vocabulary.ts";
import type { ChannelButton } from "../registry.ts";

/** The shape `render_answer` produces. Mirrors ANSWER_FIELDS in lib/ask-aval/tools.ts. */
export interface AskAnswer {
  headline: string;
  narrative: string;
  metrics?: FormattableMetric[];
  evidence_ids?: string[];
  action?: string;
  actionDetail?: string;
  confidence?: "high" | "medium" | "low";
}

/**
 * The character cap.
 *
 * WhatsApp's own limit is 4096 (1024 for the body of an interactive message,
 * which is what every answer with buttons is). The brief asks for ~1000, which
 * happens to sit just under Meta's interactive-body limit — so this is both a
 * readability choice and the transport's real ceiling. A message that exceeds
 * it is not truncated by us and then rejected by Meta; it is truncated here.
 */
export const MAX_BODY = 1000;

/** Beyond five rows, an evidence list stops being evidence and becomes a wall. */
export const MAX_EVIDENCE_ROWS = 5;

const MAX_BUTTONS = 3;

/**
 * Strip the markdown WhatsApp cannot render, and convert what it can.
 *
 * `**bold**` and `__bold__` become `*bold*`; headings, links, code fences and
 * list bullets lose their syntax and keep their text. The order matters:
 * double-asterisk must be handled before single, or `**x**` becomes `*<em>x</em>*`.
 */
export function toWhatsappMarkup(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/__([^_]+)__/g, "*$1*")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

/**
 * Evidence ids arrive as `resident:Lucía R.` — a type and a label.
 *
 * Shown as the label alone: the prefix is a provenance tag for the dashboard's
 * evidence panel, and on a phone it reads as a leaked internal identifier.
 */
function evidenceLabel(id: string): string {
  const separator = id.indexOf(":");
  return separator === -1 ? id : id.slice(separator + 1).trim();
}

export interface RenderedMessage {
  body: string;
  buttons: ChannelButton[];
  /** Set when the body was cut. The caller stores it so `MORE` can send the rest. */
  overflow: string | null;
}

/**
 * Render one answer.
 *
 * `suggestions` are the next commands to offer as buttons. They are chosen by
 * the caller (`lib/channels/suggestions.ts`) rather than by the model: a model
 * asked to propose its own follow-ups will propose ones it cannot service.
 */
export function renderAnswer(input: {
  answer: AskAnswer;
  locale: ChannelLocale;
  terms: TermMap;
  suggestions?: ChannelButton[];
}): RenderedMessage {
  const { answer, locale, terms } = input;
  const lines: string[] = [];

  const headline = toWhatsappMarkup(answer.headline ?? "").trim();
  if (headline) lines.push(`*${headline}*`);

  // Figures one per line. A phone is a narrow column; two figures on one line
  // wrap into an unreadable ragged block on a small screen.
  const metrics = (answer.metrics ?? []).slice(0, 4);
  if (metrics.length > 0) {
    lines.push("");
    for (const metric of metrics) {
      const value = formatMetricValue(metric);
      const delta = typeof metric.delta === "number" ? ` (${formatMetricDelta(metric.delta)})` : "";
      lines.push(`${metric.label}: *${value}*${delta}`);
    }
  }

  const narrative = toWhatsappMarkup(answer.narrative ?? "").trim();
  if (narrative) {
    lines.push("");
    lines.push(narrative);
  }

  const evidence = answer.evidence_ids ?? [];
  if (evidence.length > 0) {
    lines.push("");
    for (const id of evidence.slice(0, MAX_EVIDENCE_ROWS)) lines.push(`• ${evidenceLabel(id)}`);
    if (evidence.length > MAX_EVIDENCE_ROWS) {
      lines.push(`_${copy(locale, "moreEvidence", { n: evidence.length - MAX_EVIDENCE_ROWS })}_`);
    }
  }

  const full = applyTerms(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), terms);
  const { body, overflow } = truncate(full, locale);

  return {
    body,
    buttons: buildButtons(input.suggestions ?? [], overflow !== null, locale),
    overflow,
  };
}

/**
 * Cut at the cap, on a line boundary where possible.
 *
 * Cutting mid-figure would produce `Collected: *$28,` — a number that is not
 * the number. Preferring a line break means the message always ends on a
 * complete fact, and the rest is one reply away.
 */
export function truncate(text: string, locale: ChannelLocale): { body: string; overflow: string | null } {
  const suffix = copy(locale, "truncated");
  if (text.length <= MAX_BODY) return { body: text, overflow: null };

  const budget = MAX_BODY - suffix.length;
  const slice = text.slice(0, budget);
  const lastBreak = slice.lastIndexOf("\n");
  // Only honour a line break that is not absurdly early, or a long unbroken
  // paragraph would be cut to almost nothing.
  const cut = lastBreak > budget * 0.5 ? lastBreak : budget;

  return { body: `${text.slice(0, cut).trimEnd()}${suffix}`, overflow: text.slice(cut).trimStart() };
}

/**
 * Up to three buttons, `More` first when there is overflow.
 *
 * The brief is emphatic that every answer carries buttons, and it is right
 * about why: a messaging agent has no menu, no sidebar and no affordances, so
 * the buttons are the entire discoverable surface of the product. An answer
 * without them is a dead end that teaches the user nothing about what else to
 * ask.
 *
 * `More` takes a slot when it exists because reading the rest of the answer
 * you are already looking at beats a suggestion about a different question.
 */
export function buildButtons(suggestions: ChannelButton[], hasOverflow: boolean, locale: ChannelLocale): ChannelButton[] {
  const buttons: ChannelButton[] = [];
  if (hasOverflow) buttons.push({ label: copy(locale, "buttonMore"), id: "more" });
  for (const suggestion of suggestions) {
    if (buttons.length >= MAX_BUTTONS) break;
    if (buttons.some((existing) => existing.id === suggestion.id)) continue;
    buttons.push(suggestion);
  }
  return buttons;
}

/** A plain message with no answer behind it — refusals, confirmations, help. */
export function renderPlain(text: string, buttons: ChannelButton[] = [], locale: ChannelLocale = "en"): RenderedMessage {
  const { body, overflow } = truncate(toWhatsappMarkup(text), locale);
  return { body, buttons: buttons.slice(0, MAX_BUTTONS), overflow };
}
