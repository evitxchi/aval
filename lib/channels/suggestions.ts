/**
 * What the buttons on an answer offer next.
 *
 * Chosen here, deterministically, rather than by the model. A model asked to
 * suggest its own follow-ups produces plausible ones it cannot service — it
 * will offer "show me the trend by property" whether or not a tool exists that
 * can answer it, and a button that leads to "I can't answer that" is worse
 * than no button. Every suggestion below maps to a question the read tool set
 * can actually answer.
 *
 * The mapping is from the *tools the answer used*, not from its text. What the
 * agent reached for is a fact; what its narrative is "about" is an inference.
 */

import { copy, type ChannelLocale } from "./copy.ts";
import type { ChannelButton } from "./registry.ts";
import type { ChannelRole } from "./roles.ts";
import { toolNamesForRole } from "./roles.ts";

/**
 * A follow-up: the button label in both locales, the question it sends, and
 * the tool that must be available for it to be offered.
 */
interface Suggestion {
  id: string;
  label: Record<ChannelLocale, string>;
  question: Record<ChannelLocale, string>;
  requires: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    id: "ask:delinquency",
    label: { en: "Who's late", "es-mx": "Quién debe" },
    question: { en: "Who is 30+ days late?", "es-mx": "¿Quién tiene 30+ días de atraso?" },
    requires: "get_accounting_breakdown",
  },
  {
    id: "ask:vacancy",
    label: { en: "Vacant units", "es-mx": "Unidades vacías" },
    question: { en: "Which units are vacant?", "es-mx": "¿Qué unidades están vacías?" },
    requires: "get_portfolio_metrics",
  },
  {
    id: "ask:collections",
    label: { en: "Collected", "es-mx": "Cobrado" },
    question: { en: "How much have I collected this month?", "es-mx": "¿Cuánta renta he cobrado este mes?" },
    requires: "get_accounting_breakdown",
  },
  {
    id: "ask:workorders",
    label: { en: "Open work", "es-mx": "Trabajo abierto" },
    question: { en: "What work orders are still open?", "es-mx": "¿Qué órdenes de trabajo siguen abiertas?" },
    requires: "get_portfolio_metrics",
  },
  {
    id: "ask:funnel",
    label: { en: "Leasing funnel", "es-mx": "Embudo" },
    question: { en: "Show me the leasing funnel.", "es-mx": "Muéstrame el embudo de arrendamiento." },
    requires: "get_leasing_funnel",
  },
  {
    id: "ask:trend",
    label: { en: "Occupancy trend", "es-mx": "Tendencia" },
    question: { en: "How did occupancy move this quarter?", "es-mx": "¿Cómo se movió la ocupación este trimestre?" },
    requires: "get_metric_series",
  },
];

const BY_ID = new Map(SUGGESTIONS.map((suggestion) => [suggestion.id, suggestion]));

/**
 * The question behind a button id, so a tap can be answered as if typed.
 *
 * Returns null for an unrecognised id rather than guessing. A button payload
 * arrives from the network and is therefore untrusted; an id we do not know is
 * an id we do not act on.
 */
export function questionForSuggestion(id: string, locale: ChannelLocale): string | null {
  return BY_ID.get(id)?.question[locale] ?? null;
}

/**
 * Up to `limit` follow-ups for an answer.
 *
 * Excludes anything the role cannot reach — offering a coordinator a button
 * for a ledger question they will be refused is a worse experience than
 * offering them nothing — and anything the answer just did, since repeating
 * the question you have the answer to is the one useless suggestion.
 */
export function suggestionsFor(input: {
  role: ChannelRole;
  locale: ChannelLocale;
  toolsUsed?: string[];
  limit?: number;
}): ChannelButton[] {
  const allowed = toolNamesForRole(input.role);
  const used = new Set(input.toolsUsed ?? []);
  const limit = input.limit ?? 3;

  const buttons: ChannelButton[] = [];
  for (const suggestion of SUGGESTIONS) {
    if (buttons.length >= limit) break;
    // `null` means every tool; otherwise the required tool must be in the set.
    if (allowed !== null && !allowed.includes(suggestion.requires)) continue;
    if (used.has(suggestion.requires)) continue;
    buttons.push({ id: suggestion.id, label: suggestion.label[input.locale] });
  }

  // Everything got filtered out — every relevant tool was already used, which
  // happens on a broad question. Fall back to offering help rather than an
  // answer with no onward path at all.
  if (buttons.length === 0) buttons.push({ id: "help", label: copy(input.locale, "helpHeader").replace(":", "") });

  return buttons;
}
