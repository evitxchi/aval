import { getApiIdentity } from "@/lib/integrations/session";
import { summarizeOrganizationUtilities } from "@/lib/infrastructure/summary";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const summary = await summarizeOrganizationUtilities(identity.organizationId);
  return Response.json({ summary });
}
