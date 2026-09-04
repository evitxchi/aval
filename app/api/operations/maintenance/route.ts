/**
 * GET /api/operations/maintenance
 *
 * The Maintenance tab's summary: SLA compliance by priority, category
 * breakdown, vendor scorecards, and the callback links a person still needs to
 * confirm.
 */

import { getApiIdentity } from "@/lib/integrations/session";
import { summarizeMaintenanceOperations, unitsWithOpenWork } from "@/lib/operations/maintenance";
import { parsePeriod } from "@/lib/operations/summary";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const [report, blockedUnits] = await Promise.all([
    summarizeMaintenanceOperations(identity.organizationId, period.start, period.end),
    unitsWithOpenWork(identity.organizationId),
  ]);
  return Response.json({ report, blockedUnits });
}
