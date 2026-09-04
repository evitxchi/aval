/**
 * Request-body validation for the operations routes.
 *
 * Every operations endpoint takes structured business data — money, dates,
 * enums, foreign keys — and the failure mode of getting this wrong is not a
 * crash but a wrong number on an owner's report. So the rule here is that a
 * value either parses to exactly what the schema expects or the request is
 * rejected: nothing is coerced, defaulted, or clamped into range on the
 * caller's behalf.
 *
 * `ValidationError` carries a field name so the routes can return a message
 * naming what was wrong rather than a generic 400.
 */

export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const MAX_TEXT_CHARS = 200;
export const MAX_SUMMARY_CHARS = 1000;

export function requireString(body: Record<string, unknown>, field: string, maxChars = MAX_TEXT_CHARS): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(field, `${field} is required`);
  }
  return value.trim().slice(0, maxChars);
}

export function optionalString(body: Record<string, unknown>, field: string, maxChars = MAX_TEXT_CHARS): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(field, `${field} must be a string`);
  return value.trim().slice(0, maxChars) || null;
}

export function requireEnum<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = body[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(field, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  return requireEnum(body, field, allowed);
}

/**
 * A money amount in integer cents.
 *
 * Rejects fractional input rather than rounding it. A caller sending 1234.5
 * cents has a bug — most likely dollars where cents were expected — and
 * rounding it would turn that bug into a plausible-looking figure in a
 * financial report instead of an error at the edge.
 */
export function requireCents(body: Record<string, unknown>, field: string, options: { allowNegative?: boolean } = {}): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(field, `${field} must be an integer number of cents`);
  }
  if (!options.allowNegative && value < 0) throw new ValidationError(field, `${field} cannot be negative`);
  return value;
}

export function optionalCents(body: Record<string, unknown>, field: string, options: { allowNegative?: boolean } = {}): number | null {
  if (body[field] === undefined || body[field] === null) return null;
  return requireCents(body, field, options);
}

export function optionalInt(body: Record<string, unknown>, field: string, min?: number, max?: number): number | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(field, `${field} must be an integer`);
  }
  if (min !== undefined && value < min) throw new ValidationError(field, `${field} must be at least ${min}`);
  if (max !== undefined && value > max) throw new ValidationError(field, `${field} must be at most ${max}`);
  return value;
}

export function optionalNumber(body: Record<string, unknown>, field: string, min?: number, max?: number): number | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(field, `${field} must be a number`);
  }
  if (min !== undefined && value < min) throw new ValidationError(field, `${field} must be at least ${min}`);
  if (max !== undefined && value > max) throw new ValidationError(field, `${field} must be at most ${max}`);
  return value;
}

/**
 * A date from an ISO-8601 string.
 *
 * Accepts a string only, never a number. A bare integer is ambiguous between
 * seconds and milliseconds, and reading one as the other lands a lease start
 * date in 1970 or 56000 AD — both of which sort and filter without complaint,
 * so nothing downstream would catch it.
 */
export function requireDate(body: Record<string, unknown>, field: string): Date {
  const value = body[field];
  if (typeof value !== "string") throw new ValidationError(field, `${field} must be an ISO-8601 date string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(field, `${field} is not a valid date`);
  return parsed;
}

export function optionalDate(body: Record<string, unknown>, field: string): Date | null {
  if (body[field] === undefined || body[field] === null || body[field] === "") return null;
  return requireDate(body, field);
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ValidationError(field, `${field} must be true or false`);
  return value;
}

/** Reads a JSON body, treating an unparseable one as empty so validation reports the missing field rather than a parse error. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** A bounded `?limit=` value. */
export function parseLimit(url: URL, fallback = 100, max = 500): number {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}
