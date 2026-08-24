import { getDb } from "@/db";
import { insightDecisions } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { sampleData } from "@/app/data/sample";

const VALID_DECISIONS = new Set(["approved", "denied", "sent"]);

/**
 * Records a real approve/deny/send decision on an actionable insight —
 * previously only client-side state that vanished on refresh. This is the
 * write side of the extended learning layer: what Ask Aval reads back is
 * in lib/ask-aval/usage-patterns.ts, aggregated fresh from these rows at
 * request time rather than a separately maintained "learned" table.
 */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { insightId?: string; decision?: string };
  const insightId = typeof body.insightId === "string" ? body.insightId : "";
  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!sampleData.insights.candidates.some((candidate) => candidate.id === insightId)) {
    return Response.json({ error: "Unknown insight id" }, { status: 400 });
  }
  if (!VALID_DECISIONS.has(decision)) return Response.json({ error: "Unknown decision" }, { status: 400 });

  await ensureOrganization(identity);
  await getDb().insert(insightDecisions).values({
    id: crypto.randomUUID(),
    organizationId: identity.organizationId,
    insightId,
    decision,
    createdAt: new Date(),
  });
  return Response.json({ ok: true });
}
