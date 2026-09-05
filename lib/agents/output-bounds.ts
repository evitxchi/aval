/**
 * Bounds what a tool result may spend of a task's context.
 *
 * A tool reads tenant-controlled data, so its size is tenant-controlled too. A
 * single large lease could otherwise exhaust a task's whole token budget in one
 * step, and the cost lands on whichever workspace happened to read it.
 *
 * Truncation is *announced* rather than silent. A model handed a quietly
 * shortened lease will answer confidently about a document it only partly saw;
 * one told the text was cut can say so, or read a narrower range. The marker is
 * therefore part of the contract, not a debugging aid.
 *
 * Pure and storage-free so it can be tested directly.
 */

/**
 * Roughly 25k tokens of English at ~4 characters per token — large enough for a
 * full commercial lease, small enough that one document cannot consume a whole
 * task budget.
 */
export const MAX_TOOL_RESULT_CHARS = 100_000;

/** Below this, a truncated string is too short to be worth returning at all. */
const MIN_USEFUL_CHARS = 200;

export interface BoundedResult {
  json: unknown;
  truncated: boolean;
  originalChars: number;
}

/**
 * Shortens the largest strings in a tool result until the whole thing fits.
 *
 * Long strings are trimmed in descending order of size rather than the object
 * being cut off mid-structure: a result that no longer parses is worse than a
 * shortened one, and the caller's numeric evidence is carried on sibling fields
 * that must survive intact.
 */
export function boundToolResult(json: unknown, limit = MAX_TOOL_RESULT_CHARS): BoundedResult {
  const originalChars = measure(json);
  if (originalChars <= limit) return { json, truncated: false, originalChars };

  const clone = structuredClone(json) as unknown;
  const targets = collectStrings(clone).sort((a, b) => b.value.length - a.value.length);

  for (const target of targets) {
    if (measure(clone) <= limit) break;
    const excess = measure(clone) - limit;
    const keep = Math.max(MIN_USEFUL_CHARS, target.value.length - excess - MARKER_BUDGET);
    if (keep >= target.value.length) continue;
    target.set(`${target.value.slice(0, keep)}\n\n[truncated: ${target.value.length - keep} of ${target.value.length} characters withheld. This text is incomplete — say so rather than concluding from it.]`);
  }

  return { json: clone, truncated: true, originalChars };
}

/** Headroom for the marker itself, so trimming to fit does not overshoot the limit. */
const MARKER_BUDGET = 160;

function measure(json: unknown): number {
  try { return JSON.stringify(json)?.length ?? 0; } catch { return 0; }
}

interface StringTarget { value: string; set(next: string): void }

function collectStrings(root: unknown): StringTarget[] {
  const found: StringTarget[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (typeof item === "string") found.push({ value: item, set: (next) => { node[index] = next; } });
        else walk(item);
      });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const item = record[key];
      if (typeof item === "string") found.push({ value: item, set: (next) => { record[key] = next; } });
      else walk(item);
    }
  };
  walk(root);
  return found;
}
