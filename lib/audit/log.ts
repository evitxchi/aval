/**
 * Persistence for the answer audit chain (see chain.ts for the hashing and
 * why only digests are stored).
 *
 * Two deliberate shapes here:
 *
 * - **One batched write per answer, not one per tool call.** The Ask Aval loop
 *   runs up to four rounds and several tools; writing a row inside each round
 *   would add D1 round-trips to the critical path of every question. Events
 *   are collected in memory and appended once when the answer resolves.
 *
 * - **Appending never fails the answer.** This is a bookkeeping trail, not the
 *   product. If the write fails — binding missing, a sequence race — the
 *   answer the user asked for still returns, and the failure is logged. A
 *   missing row is visible later as a sequence gap, which is the honest
 *   outcome: the chain reports that it can't vouch for that stretch rather
 *   than pretending it can.
 */

import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerAuditLog } from "@/db/schema";
import { GENESIS_HASH, chainEvents, verifyChain, type AuditEntry, type AuditEvent, type ChainVerdict } from "./chain";

/** Rows read back, newest last. */
async function readChain(organizationId: string, limit?: number): Promise<AuditEntry[]> {
  const db = getDb();
  const query = db
    .select({
      sequence: answerAuditLog.sequence,
      kind: answerAuditLog.kind,
      label: answerAuditLog.label,
      payloadDigest: answerAuditLog.payloadDigest,
      count: answerAuditLog.count,
      previousHash: answerAuditLog.previousHash,
      entryHash: answerAuditLog.entryHash,
    })
    .from(answerAuditLog)
    .where(eq(answerAuditLog.organizationId, organizationId))
    .orderBy(asc(answerAuditLog.sequence));
  const rows = limit ? await query.limit(limit) : await query;
  return rows as AuditEntry[];
}

/** The chain's current end, so a new run continues it instead of restarting. */
async function readHead(organizationId: string): Promise<{ sequence: number; hash: string }> {
  const db = getDb();
  const [row] = await db
    .select({ sequence: answerAuditLog.sequence, entryHash: answerAuditLog.entryHash })
    .from(answerAuditLog)
    .where(eq(answerAuditLog.organizationId, organizationId))
    .orderBy(sql`${answerAuditLog.sequence} desc`)
    .limit(1);
  return row ? { sequence: row.sequence, hash: row.entryHash } : { sequence: 0, hash: GENESIS_HASH };
}

/**
 * Appends a run's events to the org's chain. Returns the new head, or null if
 * nothing was written — callers must not treat null as an error worth failing
 * the request over (see the module comment).
 */
export async function appendAuditEvents(organizationId: string, events: AuditEvent[]): Promise<string | null> {
  if (events.length === 0) return null;
  try {
    const head = await readHead(organizationId);
    const entries = await chainEvents(events, head.sequence + 1, head.hash);
    const now = new Date();
    await getDb().insert(answerAuditLog).values(entries.map((entry) => ({
      id: crypto.randomUUID(),
      organizationId,
      sequence: entry.sequence,
      kind: entry.kind,
      label: entry.label,
      payloadDigest: entry.payloadDigest,
      count: entry.count,
      previousHash: entry.previousHash,
      entryHash: entry.entryHash,
      createdAt: now,
    })));
    return entries[entries.length - 1].entryHash;
  } catch (error) {
    // A unique-index violation here means two runs raced for the same
    // sequence. Losing the write is correct — better a visible gap than two
    // divergent branches that each verify in isolation.
    console.error("audit_append_failed", { organizationId, events: events.length, error });
    return null;
  }
}

export interface ChainReport extends Record<string, unknown> {
  verdict: ChainVerdict;
  /** Counts by kind, so a caller can show "47 answers, 190 tool calls, 0 gate failures". */
  totals: { answers: number; toolCalls: number; toolErrors: number; gatePassed: number; gateFailed: number };
}

/** Re-verifies an org's whole chain and summarizes it. */
export async function verifyOrganizationChain(organizationId: string): Promise<ChainReport> {
  const entries = await readChain(organizationId);
  const verdict = await verifyChain(entries);
  const totals = {
    answers: entries.filter((entry) => entry.kind === "answer").length,
    toolCalls: entries.filter((entry) => entry.kind === "tool_call").length,
    toolErrors: entries.filter((entry) => entry.kind === "tool_error").length,
    gatePassed: entries.filter((entry) => entry.kind === "verdict" && entry.label === "pass").length,
    gateFailed: entries.filter((entry) => entry.kind === "verdict" && entry.label === "fail").length,
  };
  return { verdict, totals };
}

/** Recent entries for display. Digests only — there is no payload to show. */
export async function recentAuditEntries(organizationId: string, limit = 50): Promise<AuditEntry[]> {
  const entries = await readChain(organizationId);
  return entries.slice(-limit).reverse();
}
