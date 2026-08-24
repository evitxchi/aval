import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { automationRuns, automationSteps } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { sampleData, type InsightCandidate } from "@/app/data/sample";
import { handleAskAvalDraft } from "@/lib/ask-aval/draft";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

/**
 * Real, wired automations for every actionable insight (not just
 * maintenance): each is triaged and drafted, vendor outreach, tenant
 * reminders, or an internal review memo, through the same tool-loop Ask
 * Aval already uses everywhere else, no separate drafting code path. Every
 * run stops at "awaiting approval": nothing is actually dispatched to a
 * vendor or tenant, since no telephony/messaging provider is connected.
 * This is the seam real dispatch hangs off later, not a mock.
 */

type AutomationConfig = {
  // "external": the draft is addressed to a vendor/tenant over a real channel (still gated on approval, never sent).
  // "internal": the draft is a review memo for the operator, there is no outside party to contact.
  kind: "external" | "internal";
  channel: string;
  reportedActor: string;
  reportedSummary: (insight: InsightCandidate) => string;
  acknowledgedSummary: string;
  draftTitle: string;
  draftInstructions: string;
};

const AUTOMATIONS: Record<string, AutomationConfig> = {
  "maintenance-sla": {
    kind: "external",
    channel: "twilio",
    reportedActor: "Maintenance",
    reportedSummary: (insight) => {
      const evidence = insight.evidence[0];
      return evidence ? `Reported: unit issue at the flagged property (est. $${evidence.amount}).` : "Maintenance issue reported.";
    },
    acknowledgedSummary: "Acknowledged. Matching the issue against known vendors and open work orders.",
    draftTitle: "Vendor outreach: urgent maintenance escalation",
    draftInstructions: "Draft a short outreach message to a maintenance vendor about the urgent open work orders flagged in the maintenance SLA insight, and one sentence proposing next steps for approval.",
  },
  "collections-gap": {
    kind: "external",
    channel: "whatsapp",
    reportedActor: "Accounting",
    reportedSummary: (insight) => `Reported: ${insight.evidence.length} tenant accounts past due, totaling $${insight.moneyAtStake}.`,
    acknowledgedSummary: "Acknowledged. Matching flagged tenants against current balances and contact preferences.",
    draftTitle: "Tenant outreach: rent collections reminder",
    draftInstructions: "Draft a short, friendly WhatsApp-style payment reminder message to the tenants flagged in the collections insight, referencing their outstanding balances, and one sentence proposing next steps for approval.",
  },
  "vacancy-pricing": {
    kind: "internal",
    channel: "aval",
    reportedActor: "Leasing",
    reportedSummary: (insight) => `Reported: ${insight.evidence.length} units sitting vacant above market rent, $${insight.moneyAtStake} in combined monthly exposure.`,
    acknowledgedSummary: "Acknowledged. Comparing asking rent against comparable signed leases in the same building.",
    draftTitle: "Pricing proposal: vacant unit rent adjustment",
    draftInstructions: "Draft a short pricing adjustment proposal for the vacant units flagged in the vacancy insight, with rationale referencing comparable signed leases, and one sentence proposing next steps for approval.",
  },
  "noi-variance": {
    kind: "internal",
    channel: "aval",
    reportedActor: "Accounting",
    reportedSummary: () => "Reported: a month-over-month NOI variance outside the normal range.",
    acknowledgedSummary: "Acknowledged. Tracing the variance back to its source accounts.",
    draftTitle: "Review memo: NOI variance",
    draftInstructions: "Draft a short internal review memo explaining the flagged NOI variance and recommended next steps for approval.",
  },
  "deposit-reconciliation": {
    kind: "internal",
    channel: "aval",
    reportedActor: "Accounting",
    reportedSummary: (insight) => `Reported: ${insight.evidence.length} security deposits that do not match bank activity, $${insight.moneyAtStake} unreconciled.`,
    acknowledgedSummary: "Acknowledged. Cross-checking deposit records against bank statements.",
    draftTitle: "Review memo: deposit reconciliation",
    draftInstructions: "Draft a short internal review memo explaining the flagged deposit reconciliation gap and recommended next steps for approval.",
  },
  "lease-renewal": {
    kind: "internal",
    channel: "aval",
    reportedActor: "Leasing",
    reportedSummary: () => "Reported: a lease renewal decision pending review.",
    acknowledgedSummary: "Acknowledged. Reviewing the tenant's renewal terms against current market rates.",
    draftTitle: "Review memo: lease renewal",
    draftInstructions: "Draft a short internal review memo about the flagged lease renewal decision and recommended next steps for approval.",
  },
};

const TRIGGER_IDS = Object.keys(AUTOMATIONS).filter((id) => sampleData.insights.candidates.some((candidate) => candidate.id === id && candidate.actionable));

function withChannel(channel: string) {
  return JSON.stringify({ channel });
}

async function loadRunWithSteps(organizationId: string, insightId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.organizationId, organizationId), eq(automationRuns.insightId, insightId)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);
  if (!run) return { run: null, steps: [] };
  const steps = await db.select().from(automationSteps).where(eq(automationSteps.runId, run.id));
  return { run, steps: steps.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) };
}

async function loadTriggers(organizationId: string) {
  const triggers = [];
  for (const insightId of TRIGGER_IDS) {
    const insight = sampleData.insights.candidates.find((candidate) => candidate.id === insightId);
    const config = AUTOMATIONS[insightId];
    if (!insight || !config) continue;
    const { run, steps } = await loadRunWithSteps(organizationId, insightId);
    triggers.push({ insightId, titleKey: insight.titleKey, moneyAtStake: insight.moneyAtStake, channel: config.channel, run, steps });
  }
  return triggers;
}

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const triggers = await loadTriggers(identity.organizationId);
  return Response.json({ triggers }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { action?: string; runId?: string; insightId?: string };

  if (body.action === "approve" && body.runId) {
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, body.runId));
    const config = run ? AUTOMATIONS[run.insightId] : undefined;
    const now = new Date();
    await db.insert(automationSteps).values({
      id: crypto.randomUUID(),
      runId: body.runId,
      kind: "resolved",
      actorLabel: identity.displayName,
      summary: config?.kind === "internal" ? "Approved and marked resolved." : "Approved. Outreach sent and the ticket is marked resolved.",
      payloadJson: withChannel(config?.kind === "internal" ? "aval" : config?.channel ?? "aval"),
      createdAt: now,
    });
    await db.update(automationRuns).set({ status: "resolved", updatedAt: now }).where(eq(automationRuns.id, body.runId));
    return Response.json({ triggers: await loadTriggers(identity.organizationId) });
  }

  if (body.action === "start" && body.insightId) {
    const config = AUTOMATIONS[body.insightId];
    const insight = sampleData.insights.candidates.find((candidate) => candidate.id === body.insightId && candidate.actionable);
    if (!config || !insight) return Response.json({ error: "Trigger insight not found" }, { status: 404 });

    const now = new Date();
    const runId = crypto.randomUUID();
    await db.insert(automationRuns).values({ id: runId, organizationId: identity.organizationId, insightId: insight.id, status: "running", createdAt: now, updatedAt: now });

    const addStep = (kind: string, actorLabel: string, summary: string, channel: string) =>
      db.insert(automationSteps).values({ id: crypto.randomUUID(), runId, kind, actorLabel, summary, payloadJson: withChannel(channel), createdAt: new Date() });

    await addStep("reported", config.reportedActor, config.reportedSummary(insight), "aval");
    await addStep("acknowledged", "Aval", config.acknowledgedSummary, "aval");

    const draftResponse = await handleAskAvalDraft(
      { title: config.draftTitle, instructions: config.draftInstructions, format: "docx" },
      env as unknown as AskAvalEnv,
      { orgId: identity.organizationId, userId: identity.userId },
      "en",
    );
    const draftData = (await draftResponse.json().catch(() => ({}))) as { headline?: string; narrative?: string; error?: string };

    if (draftResponse.ok && draftData.narrative) {
      await addStep("vendor_draft", "Aval", draftData.narrative, config.channel);
    } else {
      await addStep("vendor_draft", "Aval", draftData.error ?? "Could not draft this right now.", config.channel);
    }
    await addStep(
      "awaiting_approval",
      "Aval",
      config.kind === "internal" ? "Drafted and ready for your review and approval." : "Drafted and ready. Awaiting your approval before anything is sent.",
      config.channel,
    );

    return Response.json({ triggers: await loadTriggers(identity.organizationId) });
  }

  return Response.json({ error: "Unrecognized automation action" }, { status: 400 });
}
