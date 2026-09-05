/**
 * Argument redaction for audit digests and approval cards.
 *
 * Tool arguments are model-authored and can carry whatever the model just
 * read — a resident's name lifted out of a lease, an account balance, a
 * free-text note somebody outside the workspace wrote. They are also the thing
 * an approver most needs to see. This resolves that by keeping the *shape* and
 * dropping the *content*: keys survive (they come from a fixed schema and say
 * what was asked for), and values survive only when they are safe to keep.
 *
 * "Safe" is decided by what a field *is*, not by how long it is. Length alone
 * was the original rule and it failed at exactly the case named above: a
 * resident's name is eight characters, so it passed a sixty-four character
 * ceiling untouched.
 *
 * The rule that replaces it inverts the default. A value is withheld unless
 * something establishes it is safe, and only two things do:
 *
 * - **The schema declares it an enum.** A fixed vocabulary the backend wrote
 *   cannot carry a resident's name, however long the option reads, so enum
 *   values survive in full and approval cards stay legible.
 * - **It looks like an identifier.** Short, no whitespace, and clear of the
 *   sensitive key and value tests below. `acct_1` and `USD` qualify; `Jane
 *   Doe` does not, because prose has spaces and prose is where a name hides.
 *
 * Numbers are always kept: an amount is the fact an approver is deciding
 * about, and withholding it would defeat the card's one purpose.
 *
 * Kept in its own module, free of storage and tool imports, so it can be
 * tested directly — a redactor nobody can run tests against is a redactor
 * nobody can trust.
 */

/** Above this, a string is assumed to be content rather than an identifier or enum value. */
export const MAX_KEPT_STRING_CHARS = 64;

/**
 * Keys whose value is withheld whatever it looks like. Credentials first, then
 * the fields that carry a person rather than a record: an approver needs to
 * know a payment names a destination, not who lives in 4B.
 */
const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|credential|signature|private[_-]?key|ssn|tax[_-]?id|routing|iban|card|cvv|email|phone|tenant[_-]?name|resident|occupant|contact|address|dob|birth)/i;

/**
 * Value shapes that are sensitive wherever they appear, because a model can
 * put them under any key it likes — including one this module has never seen.
 */
const SENSITIVE_VALUE: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,                              // US SSN
  /\b(?:\d[ -]?){13,19}\b/,                                // card-length digit runs
  /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/,                       // email address
  /\b(sk|pk|rk)[-_](live|test)[-_][A-Za-z0-9]{8,}/i,        // provider API keys
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,                     // bearer tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,                     // PEM private keys
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/,                      // IBAN
];

/** The tool's declared argument shape, when the caller has it. */
export interface RedactionSchema {
  properties?: Record<string, unknown>;
}

export function redactArguments(args: Record<string, unknown>, schema?: RedactionSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else if (typeof value === "string") out[key] = redactString(key, value, isEnumField(schema, key));
    else if (Array.isArray(value)) out[key] = `<array:${value.length}>`;
    else if (value === undefined) out[key] = "<undefined>";
    else out[key] = `<${typeof value}>`;
  }
  return out;
}

function redactString(key: string, value: string, declaredEnum: boolean): string {
  // Checked even for an enum: a field named `api_key` has no business being
  // shown whatever the schema says about it.
  if (SENSITIVE_KEY.test(key)) return `<redacted:${value.length}>`;
  if (SENSITIVE_VALUE.some((pattern) => pattern.test(value))) return `<redacted:${value.length}>`;
  if (declaredEnum) return value;
  if (value.length > MAX_KEPT_STRING_CHARS) return `<string:${value.length}>`;
  // Whitespace is the line between an identifier and prose. An undeclared
  // free-text field is exactly where a name or a figure arrives unlabelled.
  return /\s/.test(value) ? `<string:${value.length}>` : value;
}

function isEnumField(schema: RedactionSchema | undefined, key: string): boolean {
  const rule = schema?.properties?.[key];
  return typeof rule === "object" && rule !== null && Array.isArray((rule as { enum?: unknown }).enum);
}
