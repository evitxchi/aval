/**
 * OpenAI's edge challenge is an HTML 403, not a JSON API rejection.
 * Require both parts so an unrelated HTML outage or a normal JSON 403 is not
 * mislabeled as Aval's hosted-origin limitation.
 */
export function isHostedEdgeChallenge(status: number, body: string): boolean {
  if (status !== 403) return false;
  return /<!doctype\s+html|<html(?:\s|>)|@keyframes\s+enlarge-appear|body\s*\{[^}]*font-family/i.test(body);
}

/**
 * A hosted edge block makes every ChatGPT model unusable from this runtime.
 * Keep that catalog empty so callers cannot accidentally turn a known model
 * name into a choice that is guaranteed to fail.
 */
export function hostedEdgeBlockedModelCatalog() {
  return { models: [] as string[], verified: false as const, reason: "edge_blocked" as const };
}
