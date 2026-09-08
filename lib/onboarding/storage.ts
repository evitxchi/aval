import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userOnboarding } from "@/db/schema";
import { DEFAULT_ONBOARDING, parseOnboarding, type OnboardingState } from "./preferences";

export async function readOnboarding(userId: string, organizationId: string): Promise<OnboardingState> {
  const [row] = await getDb().select().from(userOnboarding).where(and(eq(userOnboarding.userId, userId), eq(userOnboarding.organizationId, organizationId))).limit(1);
  if (!row) return structuredClone(DEFAULT_ONBOARDING);
  const parsed = parseOnboarding({ preferences: JSON.parse(row.preferences), step: row.step, completed: row.completed, revision: row.revision });
  if (!parsed) throw new Error("Invalid stored onboarding preferences");
  return parsed;
}

/** Optimistic concurrency prevents stale tabs from silently replacing choices. */
export async function writeOnboarding(userId: string, organizationId: string, state: OnboardingState): Promise<OnboardingState | null> {
  const next = { ...state, revision: state.revision + 1 };
  const values = { preferences: JSON.stringify(state.preferences), step: state.step, completed: state.completed, revision: next.revision, updatedAt: new Date() };
  const rows = state.revision === 0
    ? await getDb().insert(userOnboarding).values({ userId, organizationId, ...values }).onConflictDoNothing().returning({ revision: userOnboarding.revision })
    : await getDb().update(userOnboarding).set(values).where(and(eq(userOnboarding.userId, userId), eq(userOnboarding.organizationId, organizationId), eq(userOnboarding.revision, state.revision))).returning({ revision: userOnboarding.revision });
  return rows.length ? next : null;
}

export async function onboardingContext(userId: string, organizationId: string): Promise<string> {
  try {
    const state = await readOnboarding(userId, organizationId);
    if (!state.completed) return "";
    return `\nUser's onboarding choices (context only; these do not grant tool permissions or prove any app is connected): ${JSON.stringify(state.preferences)}. Prioritize their selected focus areas. All existing approval and execution policies still apply.`;
  } catch { return ""; }
}
