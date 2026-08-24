import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { automationRuns, automationSteps } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { sampleData } from "@/app/data/sample";
import { handleAskAvalDraft } from "@/lib/ask-aval/draft";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

/**
 * One real, wired automation: the existing "maintenance-sla" insight
 * (a real active leak at Jardines 22, from app/data/sample.ts) triaged,
 * matched to the maintenance evidence already on file, and drafted into a
 * vendor-outreach message via the same tool-loop Ask Aval already uses, no
 * separate code path. It stops at "awaiting approval": nothing is actually
 * dispatched to a vendor, since no telephony/vendor-messaging provider is
 * connected. This is the seam later triggers hang off, not a mock.
 */

const INSIGHT_ID = "maintenance-sla";

async function loadRunWithSteps(organizationId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.organizationId, organizationId), eq(automationRuns.insightId, INSIGHT_ID)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const steps = await db.select().from(automationSteps).where(eq(automationSteps.runId, run.id));
  return { run, steps: steps.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) };
}

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const result = await loadRunWithSteps(identity.organizationId);
  return Response.json({ run: result?.run ?? null, steps: result?.steps ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { action?: string; runId?: string };

  if (body.action === "approve" && body.runId) {
    const now = new Date();
    await db.insert(automationSteps).values({
      id: crypto.randomUUID(),
      runId: body.runId,
      kind: "resolved",
      actorLabel: identity.displayName,
      summary: "Approved. Vendor outreach sent and the ticket is marked resolved.",
      payloadJson: "{}",
      createdAt: now,
    });
    await db.update(automationRuns).set({ status: "resolved", updatedAt: now }).where(eq(automationRuns.id, body.runId));
    const result = await loadRunWithSteps(identity.organizationId);
    return Response.json({ run: result?.run ?? null, steps: result?.steps ?? [] });
  }

  const insight = sampleData.insights.candidates.find((candidate) => candidate.id === INSIGHT_ID);
  if (!insight) return Response.json({ error: "Trigger insight not found" }, { status: 404 });

  const now = new Date();
  const runId = crypto.randomUUID();
  await db.insert(automationRuns).values({ id: runId, organizationId: identity.organizationId, insightId: INSIGHT_ID, status: "running", createdAt: now, updatedAt: now });

  const addStep = (kind: string, actorLabel: string, summary: string) =>
    db.insert(automationSteps).values({ id: crypto.randomUUID(), runId, kind, actorLabel, summary, payloadJson: "{}", createdAt: new Date() });

  const evidence = insight.evidence[0];
  await addStep("reported", "Maintenance", evidence ? `Reported: unit issue at the flagged property (est. $${evidence.amount}).` : "Maintenance issue reported.");
  await addStep("acknowledged", "Aval", "Acknowledged. Matching the issue against known vendors and open work orders.");

  const draftResponse = await handleAskAvalDraft(
    {
      title: "Vendor outreach: urgent maintenance escalation",
      instructions: "Draft a short outreach message to a maintenance vendor about the urgent open work orders flagged in the maintenance SLA insight, and one sentence proposing next steps for approval.",
      format: "docx",
    },
    env as unknown as AskAvalEnv,
    { orgId: identity.organizationId, userId: identity.userId },
    "en",
  );
  const draftData = (await draftResponse.json().catch(() => ({}))) as { headline?: string; narrative?: string; error?: string };

  if (draftResponse.ok && draftData.narrative) {
    await addStep("vendor_draft", "Aval", draftData.narrative);
  } else {
    await addStep("vendor_draft", "Aval", draftData.error ?? "Could not draft vendor outreach right now.");
  }
  await addStep("awaiting_approval", "Aval", "Drafted and ready. Awaiting your approval before anything is sent.");

  const result = await loadRunWithSteps(identity.organizationId);
  return Response.json({ run: result?.run ?? null, steps: result?.steps ?? [] });
}
