/**
 * Subscriptions: the things we say without being asked.
 *
 * The order of operations is the whole design:
 *
 *   due? → gate (SQL) → fired? → render → send
 *                          └── no → record the run, send nothing, spend nothing
 *
 * The gate runs *before* any model call, and most runs stop there. A
 * subscription that woke up, queried the ledger, found nothing over threshold
 * and went back to sleep has done its job correctly and cost one query.
 *
 * Two subscriptions ship, as the brief specifies: a delinquency threshold
 * crossing, and a Monday summary.
 */

import { and, eq, isNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { channelIdentities, channelSubscriptions } from "@/db/schema";
import { runGate, type GateResult } from "./gates.ts";
import { sendChannelMessage } from "./outbound.ts";
import { asChannelLocale, copy, type ChannelLocale } from "./copy.ts";
import { applyTerms, defaultTerms } from "./vocabulary.ts";
import { termsFor } from "./vocabulary-store.ts";
import { renderPlain } from "./whatsapp/render.ts";
import { count } from "./trace.ts";
import { scrubError } from "./scrub.ts";
import { isDue } from "./schedule.ts";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";
import "./whatsapp/adapter.ts";

export interface SubscriptionWorkerResult {
  considered: number;
  gateSkipped: number;
  sent: number;
  failed: number;
}

/**
 * Run every subscription that is due.
 *
 * `env` is accepted but currently unused: none of the shipped subscriptions
 * needs a model, because their gates return the figures directly and the
 * message is a template around them. It stays in the signature because the
 * adaptive follow-up (P4.2) will need one, and threading it later would mean
 * touching the cron wiring again.
 */
export async function runSubscriptionWorker(env: AskAvalEnv, now = new Date()): Promise<SubscriptionWorkerResult> {
  void env;
  const db = getDb();
  const result: SubscriptionWorkerResult = { considered: 0, gateSkipped: 0, sent: 0, failed: 0 };

  // Only rows that have not run in the last hour are even considered, so a
  // one-minute cron does not evaluate every subscription sixty times an hour.
  const staleBefore = new Date(now.getTime() - 3_600_000);
  const due = await db
    .select({
      subscription: channelSubscriptions,
      identity: channelIdentities,
    })
    .from(channelSubscriptions)
    .innerJoin(channelIdentities, eq(channelIdentities.id, channelSubscriptions.channelIdentityId))
    .where(
      and(
        eq(channelSubscriptions.active, true),
        or(isNull(channelSubscriptions.lastRunAt), lte(channelSubscriptions.lastRunAt, staleBefore)),
      ),
    )
    .limit(50);

  for (const row of due) {
    const subscription = row.subscription;
    if (!isDue(subscription.schedule, subscription.timezone, subscription.lastFiredAt, now)) continue;

    result.considered += 1;
    try {
      // Claim before running. Two workers on the same minute must not both
      // send, and the guarded update is the same compare-and-set the inbound
      // queue uses.
      const claimed = await db
        .update(channelSubscriptions)
        .set({ lastRunAt: now })
        .where(
          and(
            eq(channelSubscriptions.id, subscription.id),
            subscription.lastRunAt ? eq(channelSubscriptions.lastRunAt, subscription.lastRunAt) : isNull(channelSubscriptions.lastRunAt),
          ),
        )
        .returning({ id: channelSubscriptions.id });
      if (claimed.length === 0) continue;

      // Org scoping comes from the subscription row, which was written from a
      // resolved identity. Never from the gate's params.
      const gate = await runGate(subscription.gate, {
        organizationId: subscription.organizationId,
        params: safeParams(subscription.paramsJson),
        now,
      });

      if (!gate.fired) {
        result.gateSkipped += 1;
        count("gate_skipped", { gate: subscription.gate, org: subscription.organizationId });
        continue;
      }

      const locale = asChannelLocale(subscription.locale);
      const terms = await termsFor(subscription.organizationId, locale).catch(() => defaultTerms(locale));
      const body = applyTerms(renderGate(subscription.trigger, gate, locale), terms);

      const sent = await sendChannelMessage({
        organizationId: subscription.organizationId,
        channel: "whatsapp",
        to: row.identity.externalId,
        body: renderPlain(body, [], locale).body,
        // One send per subscription per fire. A re-run inside the same window
        // collides on this key and sends nothing.
        requestKey: `sub:${subscription.id}:${windowKey(now)}`,
      });

      if (sent.status === "accepted" || sent.status === "duplicate") {
        result.sent += 1;
        await db.update(channelSubscriptions).set({ lastFiredAt: now }).where(eq(channelSubscriptions.id, subscription.id));
      } else {
        result.failed += 1;
        count("delivery_failed", { subscription: subscription.id, status: sent.status });
      }
    } catch (error) {
      result.failed += 1;
      console.error(JSON.stringify({ event: "subscription_failed", subscription: subscription.id, error: scrubError(error) }));
    }
  }

  return result;
}

/**
 * The message for a fired gate.
 *
 * Templated, not generated. The gate already produced the figures and the
 * evidence rows; asking a model to write two sentences around them would add
 * a cost and a failure mode to a message whose content is fully determined.
 */
function renderGate(trigger: string, gate: GateResult, locale: ChannelLocale): string {
  const money = (cents: number) => `$${(cents / 100).toLocaleString()}`;
  if (trigger === "delinquency_threshold") {
    const headline =
      locale === "es-mx"
        ? `*${gate.rows.length} [[resident]]s con saldo vencido: ${money(gate.totalCents)}*`
        : `*${gate.rows.length} [[resident]]s past due: ${money(gate.totalCents)}*`;
    const lines = gate.rows
      .slice(0, 5)
      .map((row) => `• ${row.label}: ${money(row.amountCents)}${row.days ? ` (${row.days}d)` : ""}`);
    const more = gate.rows.length > 5 ? `\n_${copy(locale, "moreEvidence", { n: gate.rows.length - 5 })}_` : "";
    return `${headline}\n\n${lines.join("\n")}${more}`;
  }
  return locale === "es-mx"
    ? `*Resumen semanal*\n\n[[rent]] cobrada: ${money(gate.totalCents)}`
    : `*Weekly summary*\n\n[[rent]] collected: ${money(gate.totalCents)}`;
}

/** A stored params blob is JSON written by us but read back untrusted. */
function safeParams(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A coarse bucket so the idempotency key is stable within one firing window. */
function windowKey(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${now.getUTCHours()}`;
}
