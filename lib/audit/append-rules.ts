/**
 * When a failed audit append is worth retrying.
 *
 * Kept pure and separate from log.ts for the usual reason: log.ts resolves the
 * D1 binding at module scope, and this classification is the part with a
 * judgement in it.
 */

/**
 * A violation of the unique index on (organization_id, sequence) means another
 * run took this sequence first — re-reading the head and re-chaining onto the
 * winner will succeed. Anything else (a missing binding, a schema problem) will
 * not improve by being retried, so an unrecognized error is deliberately
 * treated as *not* a collision and fails fast.
 *
 * Matched on the message rather than a driver's error code because D1, libsql
 * and node:sqlite each word and nest it differently.
 */
export function isSequenceCollision(error: unknown): boolean {
  const direct = (error as { message?: unknown })?.message;
  const nested = (error as { cause?: { message?: unknown } })?.cause?.message;
  const text = `${typeof direct === "string" ? direct : ""} ${typeof nested === "string" ? nested : ""}`;
  return /unique|constraint/i.test(text);
}
