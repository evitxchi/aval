/**
 * Picks the agent best suited to a question, the way a plugin host dispatches
 * to the right handler: read the prompt, decide which specialist owns it, let
 * that specialist take the turn.
 *
 * Two properties drive every decision here:
 *
 * 1. **A wrong route is asymmetrically harmful.** Each persona is granted a
 *    *subset* of the data tools (see personas.ts `toolNames`), so routing a
 *    cash-collections question to Brokerage & Leasing doesn't merely reframe
 *    the answer — it removes the tools needed to answer it at all, and the
 *    faithfulness gate will then correctly refuse to state figures the agent
 *    could not verify. So the fallback is always `general`, which holds every
 *    tool, and the confidence floor is deliberately high. Declining to
 *    specialize costs a little framing; specializing wrongly costs the answer.
 *
 * 2. **It must not add a round-trip.** Classifying with a model call would put
 *    an extra request in front of every question, paid for by the workspace,
 *    to choose between eight fixed options. A local scorer over curated domain
 *    vocabulary is instant, free, deterministic and testable — and unlike a
 *    model call it cannot itself be steered by text inside the prompt.
 */

import { PERSONAS, type PersonaId } from "./persona-catalog.ts";

/**
 * Vocabulary that identifies each specialist's domain, in three tiers:
 *
 * - `shape` — words describing *what kind of answer* is wanted ("trend",
 *   "forecast", "on track"). These outrank subject nouns, because a question
 *   like "the trend in occupancy" names a metric every relevant agent can
 *   already read while naming an analysis only one of them specializes in.
 *   Weighting them below `strong` sent that question to Real Estate, which
 *   would have reported a point-in-time occupancy figure instead of a trend.
 * - `strong` — subject matter decisive on its own (nobody says "delinquency"
 *   about leasing).
 * - `weak` — corroborating only; a single weak hit never specializes.
 */
interface DomainVocabulary { shape?: string[]; strong: string[]; weak: string[] }

const DOMAIN_VOCABULARY: Record<Exclude<PersonaId, "general">, DomainVocabulary> = {
  financial: {
    strong: ["noi", "revenue", "expense", "expenses", "margin", "cash", "collect", "collects", "collections", "collected", "accounting", "ledger", "profit", "income", "opex", "arrears"],
    weak: ["money", "dollar", "dollars", "cost", "costs", "budget", "financial", "finance", "spend"],
  },
  brokerage: {
    strong: ["lead", "leads", "funnel", "showing", "showings", "viewing", "viewings", "applicant", "applicants", "application", "applications", "conversion", "prospect", "prospects", "signed", "lease-up"],
    weak: ["leasing", "lease", "leases", "tour", "inquiry", "enquiry", "rent", "vacancy"],
  },
  realEstate: {
    strong: ["unit", "units", "door", "doors", "property", "properties", "building", "buildings", "floorplan", "bedroom", "bedrooms", "occupancy"],
    weak: ["portfolio", "asset", "assets", "site", "address"],
  },
  marketResearch: {
    shape: ["trend", "trends", "trending", "compare", "comparison", "benchmark", "over time", "month-over-month", "year-over-year", "historical", "history"],
    strong: [],
    weak: ["market", "average", "versus", "vs", "growth", "decline", "pattern"],
  },
  maintenance: {
    strong: ["maintenance", "repair", "repairs", "work order", "workorder", "vendor", "vendors", "contractor", "plumber", "electrician", "hvac", "broken", "leak", "turnover"],
    weak: ["fix", "issue", "issues", "urgent", "emergency", "service", "inspection"],
  },
  riskAnalyst: {
    strong: ["risk", "risks", "risky", "exposure", "delinquent", "delinquency", "default", "defaults", "concentration", "downside", "threat", "vulnerable", "worry", "worried"],
    weak: ["problem", "problems", "concern", "concerns", "flag", "warning", "safe"],
  },
  leaseReview: {
    // "lease" alone is weak — it is ordinary vocabulary in a leasing funnel
    // question too. Routing here requires wording that points at a *document*,
    // since this agent can only read documents and holds no portfolio tools.
    // Phrases here are matched loosely (see countTerm): the words must appear
    // in order and close together, so "the lease says", "the lease say", and
    // "does the lease state" all hit one entry rather than needing every
    // conjugation enumerated.
    shape: ["lease say", "lease state", "in the lease", "contract say", "document say", "per the lease", "clause", "clauses"],
    strong: ["lease agreement", "addendum", "renewal clause", "termination clause", "security deposit", "contract", "document", "statement says"],
    weak: ["lease", "leases", "terms", "obligation", "obligations", "signed", "tenant"],
  },
  portfolioOutlook: {
    shape: ["outlook", "on track", "off track", "forecast", "projection", "pace", "trajectory"],
    strong: ["expect", "expected", "ahead", "behind"],
    weak: ["future", "next quarter", "next month", "performance", "progress", "target"],
  },
};

const SHAPE_WEIGHT = 1.5;
const STRONG_WEIGHT = 1;
const WEAK_WEIGHT = 0.35;

/**
 * Minimum score before specializing. Two corroborating weak terms (0.7) is not
 * enough; one strong term plus context, or two strong terms, is. Tuned so an
 * ambiguous question stays with `general` rather than losing tools.
 */
export const MIN_ROUTE_SCORE = 1;

export interface AgentRoute {
  personaId: PersonaId;
  /** Raw vocabulary score. Higher means a clearer domain signal. */
  score: number;
  /** The matched terms, so the choice can be shown to the user and debugged. */
  matched: string[];
  /** False when nothing scored high enough and `general` was chosen as the safe default. */
  specialized: boolean;
}

/**
 * Word-boundary match, so "rent" doesn't fire on "current" and "lead" doesn't
 * fire on "leader".
 *
 * A multi-word term matches its words in order with a short gap allowed
 * between them, so one entry covers the phrasings people actually write
 * ("the lease says", "the lease clearly states") without enumerating every
 * conjugation and filler word. The trailing boundary is relaxed for the last
 * word so "say" also matches "says" and "state" matches "states".
 */
function countTerm(haystack: string, term: string): boolean {
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = term.split(" ").filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1) {
    return new RegExp(`(^|[^a-z0-9])${escape(words[0])}([^a-z0-9]|$)`, "i").test(haystack);
  }
  // Up to two intervening words between each pair keeps "lease say" matching
  // "lease clearly says" while still refusing to span a whole sentence.
  const joined = words.map(escape).join("(?:\\s+[a-z0-9'-]+){0,2}\\s+");
  return new RegExp(`(^|[^a-z0-9])${joined}`, "i").test(haystack);
}

/**
 * The agent that should take this question. Always returns a route: an
 * unrecognized or mixed-domain question routes to `general` with
 * `specialized: false`, which is the correct outcome rather than a failure.
 */
export function routeToPersona(prompt: string): AgentRoute {
  const text = prompt.toLowerCase();
  const fallback: AgentRoute = { personaId: "general", score: 0, matched: [], specialized: false };
  if (!text.trim()) return fallback;

  let best: AgentRoute | null = null;
  for (const [personaId, vocabulary] of Object.entries(DOMAIN_VOCABULARY) as [Exclude<PersonaId, "general">, DomainVocabulary][]) {
    const matched: string[] = [];
    let score = 0;
    for (const term of vocabulary.shape ?? []) {
      if (countTerm(text, term)) { score += SHAPE_WEIGHT; matched.push(term); }
    }
    for (const term of vocabulary.strong) {
      if (countTerm(text, term)) { score += STRONG_WEIGHT; matched.push(term); }
    }
    for (const term of vocabulary.weak) {
      if (countTerm(text, term)) { score += WEAK_WEIGHT; matched.push(term); }
    }
    if (score === 0) continue;
    // Ties go to the earlier persona in the registry, which orders roughly
    // general-to-specific — a deterministic rule beats an arbitrary one.
    if (!best || score > best.score) best = { personaId, score, matched, specialized: true };
  }

  if (!best || best.score < MIN_ROUTE_SCORE) return fallback;
  // Guard against a vocabulary entry drifting away from the registry.
  return PERSONAS[best.personaId] ? best : fallback;
}

/** Human-readable reason for a route, for the "handled by X" line in the UI. */
export function describeRoute(route: AgentRoute): string {
  if (!route.specialized) return "No single specialist clearly owns this, so the general assistant answered with every tool available.";
  return `Routed to ${PERSONAS[route.personaId].label} on: ${route.matched.slice(0, 4).join(", ")}.`;
}
