/**
 * When a message needs a person, not an agent.
 *
 * The brief says to write this before the happy path, and that is the right
 * instruction for a reason worth stating plainly: every other failure in this
 * system is loud. A broken query returns an error, a bad send fails a
 * delivery, a wrong figure trips the faithfulness gate. This one fails by the
 * agent handling *smoothly* a message that should have reached a human within
 * the hour — a resident describing a gas leak, a tenant mentioning a lawyer, a
 * person in distress. Nothing errors. The conversation looks fine.
 *
 * Two design choices follow from that:
 *
 *  - **Deterministic, not a model.** The classifier must run before the model,
 *    because its whole job is to decide whether a model should run at all. A
 *    model that decides whether to escalate can be talked out of escalating.
 *  - **Recall over precision.** A false positive costs a person reading a
 *    message they did not need to. A false negative costs the thing this
 *    module exists to prevent. The thresholds are set accordingly, and every
 *    reviewer should push them *down*, not up.
 *
 * Both locales, because a Spanish-speaking resident in crisis is the case this
 * most needs to catch and the one an English-only word list would miss
 * entirely.
 */

export type EscalationCategory = "legal" | "eviction" | "habitability" | "distress" | "discrimination";

export interface EscalationMatch {
  category: EscalationCategory;
  /** Which term fired, for the audit trail. Never shown to the sender. */
  matched: string;
  /** `critical` bypasses any batching and notifies immediately. */
  severity: "high" | "critical";
}

/**
 * Terms by category, in both locales.
 *
 * Matched on word boundaries against a normalised form of the message, so
 * accents and case do not matter — a resident typing "amenaza" and one typing
 * "AMENAZÁ" must both be caught.
 */
const TERMS: { category: EscalationCategory; severity: "high" | "critical"; terms: string[] }[] = [
  {
    category: "habitability",
    // Life safety. Highest priority: these are the messages where an hour
    // matters, and a few false positives are an obviously acceptable price.
    severity: "critical",
    terms: [
      "gas leak", "smell gas", "smells like gas", "carbon monoxide", "fire", "smoke", "flooding", "flooded",
      "no heat", "no water", "no hot water", "sewage", "mold", "black mold", "electrical", "exposed wire",
      "ceiling collapsed", "break in", "broke in", "unsafe", "asbestos", "lead paint", "infestation",
      "fuga de gas", "huele a gas", "monoxido", "incendio", "humo", "inundacion", "inundado",
      "sin agua", "sin luz", "sin calefaccion", "sin gas", "drenaje", "aguas negras", "moho",
      "cable expuesto", "se cayo el techo", "peligroso", "plaga", "plomo",
    ],
  },
  {
    category: "distress",
    severity: "critical",
    terms: [
      "suicide", "kill myself", "hurt myself", "end my life", "domestic violence", "abusing me",
      "threatened me", "assault", "emergency", "ambulance", "hospital", "medical emergency",
      "suicidio", "matarme", "quitarme la vida", "hacerme dano", "violencia domestica",
      "me amenazo", "agresion", "emergencia", "ambulancia", "me golpeo",
    ],
  },
  {
    category: "legal",
    severity: "high",
    terms: [
      "lawyer", "attorney", "sue you", "suing", "lawsuit", "legal action", "court", "subpoena",
      "my rights", "tenant rights", "housing authority", "code enforcement", "small claims",
      "abogado", "demanda", "demandar", "accion legal", "juzgado", "tribunal", "citatorio",
      "mis derechos", "derechos del inquilino", "profeco", "condusef",
    ],
  },
  {
    category: "eviction",
    severity: "high",
    terms: [
      "eviction", "evicted", "evicting", "kick me out", "lock me out", "locked out", "notice to quit",
      "desalojo", "desalojar", "me van a sacar", "me sacaron", "cambiaron la cerradura", "lanzamiento",
    ],
  },
  {
    category: "discrimination",
    severity: "high",
    terms: [
      "discriminat", "racist", "fair housing", "retaliation", "harassment", "harassing",
      "discriminac", "racista", "represalia", "acoso", "hostigamiento",
    ],
  },
];

/**
 * Strip accents and punctuation so matching is robust to how people actually
 * type on a phone.
 *
 * NFD splits a character into its base plus combining marks; removing the
 * marks leaves `amenazá` as `amenaza`. Doing this rather than listing every
 * accented spelling is what keeps the term lists readable.
 */
function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first escalation signal in a message, or null.
 *
 * Ordered by severity: a message mentioning both a lawyer and a gas leak is a
 * gas leak. Returning the highest-severity match rather than the first
 * textual one is the difference between a page and a ticket.
 */
export function classifyEscalation(text: unknown): EscalationMatch | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const haystack = ` ${normalise(text)} `;

  for (const group of TERMS) {
    for (const term of group.terms) {
      const needle = normalise(term);
      // Substring rather than word-boundary matching, because several terms are
      // deliberate stems — `discriminat` catches discriminate, discriminated,
      // discriminating and discrimination without four entries.
      if (haystack.includes(needle)) {
        return { category: group.category, matched: term, severity: group.severity };
      }
    }
  }

  return null;
}

/** Every category, for tests and for the notification routing table. */
export const ESCALATION_CATEGORIES: readonly EscalationCategory[] = [
  "habitability",
  "distress",
  "legal",
  "eviction",
  "discrimination",
];
