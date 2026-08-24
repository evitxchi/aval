/**
 * Sliding-window rate limiting, backed by D1 rather than in-memory state —
 * a Worker isolate can be recycled between requests, so an in-memory
 * counter would silently reset and stop protecting anything. Same idiom as
 * lib/ask-aval/usage.ts's daily model-call cap: one row per attempt,
 * counted by querying rows within the window.
 *
 * Exists to close two real abuse paths: unlimited free-account creation
 * (each new org gets its own token allowance, so this is a direct route to
 * free, unmetered Claude API spend) and unlimited login attempts against a
 * known email (password brute-forcing).
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimitHits } from "@/db/schema";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/** True if `scopeKey` has already hit its limit within the window — check BEFORE doing the guarded work, then call recordAttempt regardless of outcome. */
export async function isRateLimited(scopeKey: string, rule: RateLimitRule): Promise<boolean> {
  const db = getDb();
  const windowStart = new Date(Date.now() - rule.windowMs);
  const hits = await db
    .select({ id: rateLimitHits.id })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.scopeKey, scopeKey), gte(rateLimitHits.createdAt, windowStart)));
  return hits.length >= rule.limit;
}

export async function recordAttempt(scopeKey: string): Promise<void> {
  try {
    await getDb().insert(rateLimitHits).values({ id: crypto.randomUUID(), scopeKey, createdAt: new Date() });
  } catch (err) {
    // Fails open on a storage hiccup — a missed rate-limit row degrades
    // throttling for one request, not availability for a real user.
    console.error("rate_limit_record_failed", scopeKey, err);
  }
}

/** The real client IP behind Cloudflare's edge — set by Cloudflare itself and not something a client request can override, unlike X-Forwarded-For. */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
