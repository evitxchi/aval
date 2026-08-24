import { env } from "cloudflare:workers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { handleAskAval } from "@/lib/ask-aval/handler";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = await request.json().catch(() => ({})) as { question?: string; locale?: string; moduleLabel?: string; moduleSnapshot?: string };
  const question = typeof body.question === "string" ? body.question.slice(0, 600) : "";
  const locale = body.locale === "es-mx" ? "es-mx" : "en";
  const focusedModule = body.moduleLabel ? { label: body.moduleLabel, snapshot: body.moduleSnapshot ?? "" } : undefined;

  return handleAskAval(question, env as unknown as AskAvalEnv, { orgId: identity.organizationId, userId: identity.userId }, locale, focusedModule);
}
