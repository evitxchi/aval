/**
 * Maps a free-typed instruction onto the fixed preference taxonomy.
 *
 * The Setup view lets a workspace type "always get me three quotes before
 * booking a plumber" in their own words. What gets *stored* is still only a
 * fixed tag (vendor_selection / always_compare_multiple_quotes) — the typed
 * sentence is classified and then discarded, never written to the database.
 * That keeps the privacy guarantee in preference-taxonomy.ts intact (no
 * tenant name, address or amount can reach memory) while letting people say
 * what they mean instead of hunting through a list.
 *
 * Deliberately a local scorer rather than a model call: the taxonomy is
 * twelve statements, so matching is cheap, instant, deterministic and
 * testable, and it costs the workspace no tokens. When nothing scores well
 * enough the caller is told so and shows the list — a wrong confident guess
 * about how someone wants their money spent is worse than asking.
 */

import { PREFERENCE_TOPICS, describePreference, type PreferenceTopic } from "./preference-taxonomy.ts";

/** Words too common to carry meaning here; matching on them produces noise. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "to", "for", "of", "on", "in", "at", "by", "with",
  "is", "are", "be", "been", "was", "were", "do", "does", "did", "should", "would", "could",
  "i", "we", "you", "me", "my", "our", "us", "it", "this", "that", "them", "they",
  "please", "always", "never", "any", "all", "some", "when", "than", "then", "how", "what",
]);

/**
 * Extra vocabulary per statement — the words people actually use, which the
 * canonical label doesn't contain ("bids" for quotes, "text" for WhatsApp,
 * "short" for brief).
 */
const SYNONYMS: Record<string, string[]> = {
  always_compare_multiple_quotes: ["quote", "quotes", "bid", "bids", "estimate", "estimates", "compare", "three", "multiple", "shop", "around", "competing"],
  prefer_fastest_available_vendor: ["fast", "fastest", "quick", "quickest", "soonest", "speed", "urgent", "asap", "available", "rapid"],
  prefer_lowest_cost_vendor: ["cheap", "cheapest", "lowest", "cost", "price", "budget", "affordable", "inexpensive", "save"],
  prefer_whatsapp_for_tenants: ["whatsapp", "text", "texting", "message", "sms", "chat"],
  prefer_email_for_tenants: ["email", "emails", "mail", "inbox", "write"],
  prefer_phone_for_urgent_issues: ["phone", "call", "calling", "ring", "voice", "urgent", "emergency"],
  keep_summaries_brief: ["brief", "short", "concise", "summary", "summaries", "quick", "tldr", "terse", "succinct"],
  include_full_breakdowns: ["full", "detail", "detailed", "breakdown", "breakdowns", "line", "item", "itemized", "complete", "thorough"],
  flag_variances_over_5_percent: ["variance", "variances", "flag", "percent", "deviation", "swing", "change", "5"],
  always_ask_before_spend_over_500: ["approval", "approve", "ask", "before", "spend", "spending", "500", "over", "threshold", "permission"],
  always_ask_before_any_vendor_booking: ["approval", "approve", "ask", "before", "book", "booking", "vendor", "hire", "permission", "every"],
  auto_approve_under_200: ["auto", "automatic", "automatically", "approve", "under", "200", "small", "routine", "without"],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

export interface PreferenceMatch {
  topic: PreferenceTopic;
  statement: string;
  label: string;
  /** 0-1. Below MIN_CONFIDENCE the caller should ask rather than assume. */
  confidence: number;
}

/** Below this, the guess isn't worth acting on and the user is shown the list instead. */
export const MIN_CONFIDENCE = 0.3;

/**
 * Vocabulary per statement: its curated synonyms, plus the words of its own
 * label — but only those the label doesn't share with another statement's
 * synonyms. Labels are prose and sometimes name the option they're contrasted
 * against ("Prefer the fastest available vendor over the cheapest"), which
 * otherwise files "cheapest" under the *fastest* statement and classifies
 * "pick the cheapest contractor" exactly backwards.
 */
function buildVocabularies(): Map<string, Set<string>> {
  const claimedBySynonym = new Map<string, Set<string>>();
  for (const [statement, words] of Object.entries(SYNONYMS)) {
    for (const word of words) {
      if (!claimedBySynonym.has(word)) claimedBySynonym.set(word, new Set());
      claimedBySynonym.get(word)!.add(statement);
    }
  }

  const vocabularies = new Map<string, Set<string>>();
  for (const topic of Object.keys(PREFERENCE_TOPICS) as PreferenceTopic[]) {
    for (const statement of PREFERENCE_TOPICS[topic]) {
      const vocabulary = new Set(SYNONYMS[statement] ?? []);
      for (const word of tokenize(describePreference(topic, statement))) {
        const owners = claimedBySynonym.get(word);
        if (owners && !owners.has(statement)) continue; // another option's word
        vocabulary.add(word);
      }
      vocabularies.set(statement, vocabulary);
    }
  }
  return vocabularies;
}

const VOCABULARIES = buildVocabularies();

/** How many statements use a word — a word unique to one is far more diagnostic than a shared one. */
const WORD_OWNERS: Map<string, number> = (() => {
  const counts = new Map<string, number>();
  for (const vocabulary of VOCABULARIES.values()) {
    for (const word of vocabulary) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
})();

/**
 * Best-scoring statement for a typed instruction, or null when nothing is a
 * confident-enough match.
 *
 * Matched words are weighted by how exclusive they are (a word only one
 * statement uses counts fully; one shared by six counts a sixth), so a single
 * decisive word like "soonest" carries a sentence that is otherwise all
 * filler. Dividing by the square root of the typed length keeps padding from
 * inflating a weak match without punishing anyone for writing a real sentence.
 */
export function matchPreference(text: string): PreferenceMatch | null {
  const words = new Set(tokenize(text));
  if (words.size === 0) return null;

  let best: PreferenceMatch | null = null;
  for (const topic of Object.keys(PREFERENCE_TOPICS) as PreferenceTopic[]) {
    for (const statement of PREFERENCE_TOPICS[topic]) {
      const vocabulary = VOCABULARIES.get(statement)!;
      let score = 0;
      for (const word of words) {
        if (!vocabulary.has(word)) continue;
        score += 1 / (WORD_OWNERS.get(word) ?? 1);
      }
      if (score === 0) continue;
      const confidence = Math.min(score / Math.sqrt(words.size), 1);
      if (!best || confidence > best.confidence) {
        best = { topic, statement, label: describePreference(topic, statement), confidence };
      }
    }
  }
  return best && best.confidence >= MIN_CONFIDENCE ? best : null;
}

/** Example phrasings per topic, for the "suggest something to teach" panel. */
export const TEACHING_SUGGESTIONS: Record<PreferenceTopic, string[]> = {
  vendor_selection: [
    "Always get me three quotes before booking anyone.",
    "Go with whoever can get there soonest.",
    "Pick the lowest-cost option when quality is the same.",
  ],
  communication_channel: [
    // Each suggestion names only its own option: mentioning the one it's
    // contrasted against ("email rather than texting") makes the sentence
    // classify as the option it was arguing against.
    "Message tenants on WhatsApp.",
    "Send tenants an email.",
    "Call me for anything urgent.",
  ],
  reporting_style: [
    "Keep summaries short.",
    "I want the full line-item breakdown.",
    "Flag anything that moves more than 5%.",
  ],
  approval_threshold: [
    "Ask me before spending more than $500.",
    "Ask before booking any vendor at all.",
    "Auto-approve the small routine stuff.",
  ],
};
