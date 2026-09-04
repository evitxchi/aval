/**
 * Argument redaction for audit digests and approval cards.
 *
 * Tool arguments are model-authored and can carry whatever the model just
 * read — a resident's name lifted out of a lease, an account balance, a
 * free-text note somebody outside the workspace wrote. They are also the thing
 * an approver most needs to see. This resolves that by keeping the *shape* and
 * dropping the *content*: keys survive (they come from a fixed schema and say
 * what was asked for), and values survive only when they are structurally safe
 * to keep.
 *
 * Kept in its own module, free of storage and tool imports, so it can be
 * tested directly — a redactor nobody can run tests against is a redactor
 * nobody can trust.
 */

/** Above this, a string is assumed to be content rather than an identifier or enum value. */
export const MAX_KEPT_STRING_CHARS = 64;

export function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else if (typeof value === "string") out[key] = value.length <= MAX_KEPT_STRING_CHARS ? value : `<string:${value.length}>`;
    else if (Array.isArray(value)) out[key] = `<array:${value.length}>`;
    else if (value === undefined) out[key] = "<undefined>";
    else out[key] = `<${typeof value}>`;
  }
  return out;
}
