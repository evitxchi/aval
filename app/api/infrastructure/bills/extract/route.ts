import { env } from "cloudflare:workers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { handleUtilityBillExtraction } from "@/lib/infrastructure/bill-extraction";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as { billText?: string };
  const billText = typeof body.billText === "string" ? body.billText : "";

  return handleUtilityBillExtraction(billText, env as unknown as AskAvalEnv, { orgId: identity.organizationId, userId: identity.userId });
}
