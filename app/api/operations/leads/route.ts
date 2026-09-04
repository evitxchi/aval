/**
 * GET   /api/operations/leads — leads with their stage timestamps.
 * POST  /api/operations/leads — record an inquiry.
 * PATCH /api/operations/leads — advance a lead, or mark it lost.
 *
 * Stage timestamps rather than a stage counter are what let the funnel say
 * where it leaks and how long each step takes — see `lib/operations/metrics/funnel.ts`.
 */

import { ensureOrganization } from "@/lib/integrations/organizations";
import { getApiIdentity } from "@/lib/integrations/session";
import { operationsErrorResponse } from "@/lib/operations/errors";
import { advanceLead, createLead, listLeads, markLeadLost } from "@/lib/operations/leasing";
import { ALL_LEAD_STAGES, type LeadStage } from "@/lib/operations/types";
import { optionalDate, optionalString, readJsonBody, requireEnum, requireString } from "@/lib/operations/validation";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const leads = await listLeads(
    identity.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
  );
  return Response.json({ leads });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  try {
    const body = await readJsonBody(request);
    const lead = await createLead(identity.organizationId, {
      propertyId: optionalString(body, "propertyId", 64),
      unitId: optionalString(body, "unitId", 64),
      residentId: optionalString(body, "residentId", 64),
      channel: optionalString(body, "channel", 60),
      unitTypeLabel: optionalString(body, "unitTypeLabel", 40),
      inquiredAt: optionalDate(body, "inquiredAt") ?? undefined,
    });
    return Response.json({ lead }, { status: 201 });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const body = await readJsonBody(request);
    const leadId = requireString(body, "leadId", 64);
    const stage = requireEnum(body, "stage", ALL_LEAD_STAGES) as LeadStage;
    const at = optionalDate(body, "at") ?? new Date();

    if (stage === "lost") {
      // A lost lead needs its reason: "why did we lose them" is the only
      // question the lost bucket can usefully answer, and a bucket of
      // reasonless losses answers nothing.
      await markLeadLost(identity.organizationId, leadId, requireString(body, "lostReason", 200), at);
      return Response.json({ ok: true });
    }

    const lead = await advanceLead(identity.organizationId, leadId, stage, at);
    return Response.json({ lead });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}
