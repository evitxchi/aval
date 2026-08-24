import { env } from "cloudflare:workers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { handleAskAvalDraft, type DraftFormat } from "@/lib/ask-aval/draft";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    instructions?: string;
    format?: string;
    locale?: string;
    moduleLabel?: string;
    moduleSnapshot?: string;
  };
  const title = typeof body.title === "string" ? body.title : "";
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const format: DraftFormat = body.format === "xlsx" || body.format === "pptx" ? body.format : "docx";
  const locale = body.locale === "es-mx" ? "es-mx" : "en";
  const focusedModule = body.moduleLabel ? { label: body.moduleLabel, snapshot: body.moduleSnapshot ?? "" } : undefined;

  return handleAskAvalDraft(
    { title, instructions, format },
    env as unknown as AskAvalEnv,
    { orgId: identity.organizationId, userId: identity.userId },
    locale,
    focusedModule,
  );
}
