/**
 * GET /api/operations/leasing
 *
 * The Leasing tab's own summary — funnel, velocity, channels, renewals and the
 * expiration schedule — without the cost of the other three tabs' queries.
 */

import { getApiIdentity } from "@/lib/integrations/session";
import { availableUnits, summarizeLeasing } from "@/lib/operations/leasing";
import { parsePeriod } from "@/lib/operations/summary";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const [summary, available] = await Promise.all([
    summarizeLeasing(identity.organizationId, period.start, period.end),
    availableUnits(identity.organizationId),
  ]);
  return Response.json({ summary, availableUnits: available });
}
