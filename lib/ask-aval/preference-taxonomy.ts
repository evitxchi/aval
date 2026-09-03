/**
 * The fixed preference taxonomy, split out from preferences.ts so it can be
 * read without touching the database — both by tests running under plain
 * `node --test` (which can't resolve the `@/db` path alias) and by anything
 * that only needs to know what the allowed tags are.
 *
 * This list IS the privacy guarantee: the model never writes free text into
 * memory. It classifies a correction into one of these fixed generic tags —
 * never a tenant name, dollar amount, address, or anything else specific to
 * a workspace's actual business — and only the tag is stored.
 */

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

/** Every topic with its allowed statements and human labels — what the Setup view offers as choices. */
export function listPreferenceOptions(): { topic: PreferenceTopic; statements: { statement: string; label: string }[] }[] {
  return (Object.keys(PREFERENCE_TOPICS) as PreferenceTopic[]).map((topic) => ({
    topic,
    statements: PREFERENCE_TOPICS[topic].map((statement) => ({ statement, label: describePreference(topic, statement) })),
  }));
}
