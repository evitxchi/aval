/**
 * Scrubbing, for anything that leaves the system as a log, trace, or error.
 *
 * This channel handles the two most sensitive data types this product touches
 * at once: a phone number that identifies a real person, and message text that
 * person wrote. Neither may reach an error report. `lib/agents/redaction.ts`
 * already solves the adjacent problem — redacting *tool arguments* for audit
 * digests and approval cards — but it is shaped around a known schema, and log
 * lines are free text. So this is the transport-level counterpart, not a
 * duplicate of it.
 *
 * The Mexican identifiers matter specifically. CURP and RFC are the national
 * identity and tax numbers, and under the LFPDPPP they are personal data with
 * the same weight Brazil's LGPD gives a CPF. A resident sending "my CURP is
 * ..." to ask about their lease must not deposit it in a log line forever.
 *
 * The default is to withhold. Everything below either matches a known
 * sensitive shape and is replaced, or is not free text at all.
 */

/** CURP: 18 characters, a fixed and very distinctive shape. */
const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi;

/** RFC: 12 (moral) or 13 (física) characters. */
const RFC = /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi;

/** Any run of digits long enough to be a phone number, with or without separators. */
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

const EMAIL = /\b[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]{2,}\b/gi;

/** Bearer tokens, Meta access tokens, and anything else that looks like a secret. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const META_TOKEN = /\bEAA[A-Za-z0-9]{20,}/g;

/** A query string carrying a token, verify token, or signature. */
const URL_SECRET = /([?&](?:access_token|token|verify_token|hub\.verify_token|signature|sig|key|secret)=)[^&\s]+/gi;

/**
 * Replace every sensitive shape in a string.
 *
 * Order matters: tokens and URLs first, because a Meta token is a long
 * alphanumeric run that a looser pattern would otherwise partially match and
 * leave a usable prefix of. Email before phone, because an address can contain
 * a digit run that the phone pattern would otherwise claim half of.
 */
export function scrub(value: string): string {
  return value
    .replace(URL_SECRET, "$1[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(META_TOKEN, "[token]")
    .replace(EMAIL, "[email]")
    .replace(CURP, "[curp]")
    .replace(RFC, "[rfc]")
    .replace(PHONE, "[phone]");
}

/**
 * A phone number reduced to something that can be correlated but not dialled.
 *
 * Logs still need to distinguish two senders — "the same number retried four
 * times" is an operational fact worth having — so the country code and the
 * last two digits survive and the identifying middle does not. This is not a
 * hash: a hash of a phone number is trivially reversible by enumerating the
 * number space, which is small.
 */
export function phoneFingerprint(externalId: string): string {
  const digits = externalId.replace(/\D/g, "");
  if (digits.length < 6) return "[phone]";
  return `+${digits.slice(0, 2)}…${digits.slice(-2)}`;
}

/**
 * Scrub a value of any shape for inclusion in a trace or log.
 *
 * Objects are walked and strings replaced. Keys whose *name* marks them
 * sensitive are dropped wholesale rather than pattern-matched, because a field
 * called `body` or `accessToken` is sensitive regardless of whether its
 * current value happens to look like anything.
 */
const SENSITIVE_KEYS = /^(body|text|message|content|displayName|name|token|accessToken|secret|password|authorization|credential|payload|args|arguments)$/i;

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return scrub(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => scrubValue(entry, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.test(key) ? "[redacted]" : scrubValue(entry, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}

/**
 * An error reduced to something safe to log.
 *
 * The message is scrubbed because provider errors quote the request that
 * failed, which for a send is the message body and the recipient's number. The
 * stack is dropped entirely: it adds little for an error class we raised
 * ourselves, and it is another place a captured variable can surface.
 */
export function scrubError(error: unknown): string {
  if (error instanceof Error) return scrub(error.message);
  if (typeof error === "string") return scrub(error);
  return "unknown error";
}
