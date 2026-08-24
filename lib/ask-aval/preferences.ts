/**
 * Closed-loop learning without retaining business information: the model
 * never writes free text into memory. It classifies a user's correction
 * into one of a small, fixed set of generic behavioral tags defined here
 * (never containing a tenant name, dollar amount, address, or anything
 * else specific to this workspace's actual business), and only that tag is
 * stored. Nothing here is used to fine-tune or otherwise train the
 * underlying model. Storage is a plain per-org row read back into future
 * system prompts as context, the same way any other tool result is used,
 * fully deletable, and never shared across organizations.
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { learnedPreferences } from "@/db/schema";

export const PREFERENCE_TOPICS = {
  vendor_selection: [
    "always_compare_multiple_quotes",
    "prefer_fastest_available_vendor",
    "prefer_lowest_cost_vendor",
  ],
  communication_channel: [
    "prefer_whatsapp_for_tenants",
    "prefer_email_for_tenants",
    "prefer_phone_for_urgent_issues",
  ],
  reporting_style: [
    "keep_summaries_brief",
    "include_full_breakdowns",
    "flag_variances_over_5_percent",
  ],
  approval_threshold: [
    "always_ask_before_spend_over_500",
    "always_ask_before_any_vendor_booking",
    "auto_approve_under_200",
  ],
} as const;

export type PreferenceTopic = keyof typeof PREFERENCE_TOPICS;

const STATEMENT_LABELS: Record<string, string> = {
  always_compare_multiple_quotes: "Always compare multiple vendor quotes before booking.",
  prefer_fastest_available_vendor: "Prefer the fastest available vendor over the cheapest.",
  prefer_lowest_cost_vendor: "Prefer the lowest-cost vendor when quality is comparable.",
  prefer_whatsapp_for_tenants: "Prefer WhatsApp for tenant communication.",
  prefer_email_for_tenants: "Prefer email for tenant communication.",
  prefer_phone_for_urgent_issues: "Prefer a phone call for urgent issues.",
  keep_summaries_brief: "Keep report summaries brief.",
  include_full_breakdowns: "Include full line-item breakdowns in reports.",
  flag_variances_over_5_percent: "Flag any variance over 5% explicitly.",
  always_ask_before_spend_over_500: "Always ask for approval before any spend over $500.",
  always_ask_before_any_vendor_booking: "Always ask for approval before booking any vendor.",
  auto_approve_under_200: "Auto-approve routine spend under $200.",
};

export function describePreference(topic: string, statement: string): string {
  return STATEMENT_LABELS[statement] ?? `${topic}: ${statement}`;
}

export async function recordPreference(organizationId: string, topic: PreferenceTopic, statement: string): Promise<void> {
  const allowed: readonly string[] = PREFERENCE_TOPICS[topic] ?? [];
  if (!allowed.includes(statement)) return;
  const db = getDb();
  const existing = await db
    .select()
    .from(learnedPreferences)
    .where(and(eq(learnedPreferences.organizationId, organizationId), eq(learnedPreferences.topic, topic)))
    .limit(1);
  const now = new Date();
  if (existing.length > 0) {
    await db
      .update(learnedPreferences)
      .set({ statement, source: "ask_aval", createdAt: now })
      .where(and(eq(learnedPreferences.organizationId, organizationId), eq(learnedPreferences.topic, topic)));
  } else {
    await db.insert(learnedPreferences).values({ id: crypto.randomUUID(), organizationId, topic, statement, source: "ask_aval", createdAt: now });
  }
}

export async function getPreferenceContext(organizationId: string): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(learnedPreferences).where(eq(learnedPreferences.organizationId, organizationId));
  if (rows.length === 0) return "";
  const lines = rows.map((row) => `- ${describePreference(row.topic, row.statement)}`);
  return `\n\nKnown preferences for this workspace, learned from prior corrections (apply them, do not restate them as new findings):\n${lines.join("\n")}`;
}
