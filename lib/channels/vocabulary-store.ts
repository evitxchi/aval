/**
 * The storage half of the per-org term map.
 *
 * Separated from `vocabulary.ts` so the rules — what a valid term is, how
 * substitution works — stay testable without a database. This file is the only
 * part that needs one, and it is deliberately thin: everything it reads goes
 * straight through `sanitiseOverrides` before it can reach a message.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { communicationSettings } from "@/db/schema";
import { defaultTerms, sanitiseOverrides, type TermMap } from "./vocabulary.ts";
import type { ChannelLocale } from "./copy.ts";

/**
 * The term map for one organization, defaults merged with its overrides.
 *
 * Reads `communication_settings.configJson`, which is where this product
 * already keeps per-org communication preferences — a second settings table
 * for seven words would be its own small mistake.
 */
export async function termsFor(organizationId: string, locale: ChannelLocale): Promise<TermMap> {
  const base = defaultTerms(locale);
  const [row] = await getDb()
    .select({ configJson: communicationSettings.configJson })
    .from(communicationSettings)
    .where(eq(communicationSettings.organizationId, organizationId))
    .limit(1);
  if (!row) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.configJson);
  } catch {
    // A malformed settings blob degrades to defaults. The alternative is an
    // org whose messaging stops working because of a bad character in a
    // preference nobody remembers setting.
    return base;
  }

  const vocabulary = (parsed as { vocabulary?: Record<string, unknown> } | null)?.vocabulary;
  const overrides = sanitiseOverrides((vocabulary as Record<string, unknown> | undefined)?.[locale] ?? vocabulary);
  return { ...base, ...overrides };
}
