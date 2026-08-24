/**
 * Shared faithfulness gate: every numeral in a model's final answer must
 * trace back to a number the caller has already verified (a tool result, or
 * a fact bundle passed in directly). Fails closed — a violation means the
 * answer gets withheld rather than shipped with an invented figure.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The system prompt explicitly permits "arithmetic decomposition" (e.g.
 * billed minus collected, a share expressed as a percentage) as long as it's
 * hedged as computed rather than asserted as a new fact. A literal-match-only
 * gate would reject those correct, real, derived figures just as readily as
 * an invented one — so every pairwise sum, absolute difference, and percent
 * ratio between two already-verified numbers is added before the check runs.
 * This stays bounded (still traceable to real verified numbers, not
 * open-ended) while no longer flagging ordinary subtraction as a violation.
 */
export function withDerivedNumbers(seen: Set<number>): Set<number> {
  const base = [...seen];
  const expanded = new Set(seen);
  for (const a of base) {
    for (const b of base) {
      if (a === b) continue;
      expanded.add(round2(a + b));
      expanded.add(round2(Math.abs(a - b)));
      if (b !== 0) expanded.add(round2((a / b) * 100));
    }
  }
  return expanded;
}

/** Tolerate the model rounding 28,512.40 to 28,512 or a nearby restatement. */
function nearMatch(n: number, seen: Set<number>): boolean {
  for (const s of seen) {
    if (s === 0) continue;
    if (Math.abs(s - n) / Math.abs(s) < 0.005) return true;
    if (Math.round(s) === Math.round(n)) return true;
  }
  return false;
}

const IGNORE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 30, 60, 90, 100]);

/**
 * Pulls every numeral out of an answer, walking the whole object rather than
 * a fixed field list — a draft's `document`/`metrics`/table rows and a quick
 * answer's `narrative`/`chart.points` are both covered without either shape
 * needing to know about the other.
 */
export function extractClaimedNumbers(answer: unknown): number[] {
  const claimed: number[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "number") {
      if (Number.isFinite(value)) claimed.push(round2(value));
    } else if (typeof value === "string") {
      const matches = value.match(/-?\d[\d,]*\.?\d*/g) ?? [];
      for (const match of matches) {
        const n = Number(match.replace(/,/g, ""));
        if (Number.isFinite(n)) claimed.push(round2(n));
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(answer);
  return claimed;
}

export function checkFaithfulness(answer: unknown, seen: Set<number>): { ok: true } | { ok: false; unsupported: number[] } {
  const claimed = extractClaimedNumbers(answer);
  const unsupported = claimed.filter((n) => !seen.has(n) && !IGNORE.has(n) && !nearMatch(n, seen));
  return unsupported.length === 0 ? { ok: true } : { ok: false, unsupported };
}
