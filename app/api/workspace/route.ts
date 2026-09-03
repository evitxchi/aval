import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

/**
 * Lightweight facts about the caller's workspace. Currently just its creation
 * date, which the Overview hero turns into "day N with Aval". Kept as its own
 * fetch rather than server-rendered into the page so the dashboard route
 * doesn't need the D1 binding just to draw a greeting.
 */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const organization = await ensureOrganization(identity);
  return Response.json({ createdAt: organization.createdAt.toISOString() });
}
