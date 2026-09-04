import { env } from "cloudflare:workers";
import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { handleAskAvalDraft, type DraftFormat } from "@/lib/ask-aval/draft";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";
import { getDb } from "@/db";
import { draftDocuments } from "@/db/schema";

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
    documentType?: string;
    personaId?: string;
  };
  const title = typeof body.title === "string" ? body.title : "";
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const format: DraftFormat = body.format === "xlsx" || body.format === "pptx" ? body.format : "docx";
  const documentType = typeof body.documentType === "string" ? body.documentType.trim().slice(0, 60) : "";
  const locale = body.locale === "es-mx" ? "es-mx" : "en";
  const focusedModule = body.moduleLabel ? { label: body.moduleLabel, snapshot: body.moduleSnapshot ?? "" } : undefined;

  const response = await handleAskAvalDraft(
    { title, instructions, format },
    env as unknown as AskAvalEnv,
    { orgId: identity.organizationId, userId: identity.userId },
    locale,
    focusedModule,
    body.personaId,
    isGuestIdentity(identity),
  );

  // Persist the result (success or failure) so a page refresh doesn't lose
  // it — the client's job state otherwise lives only in memory. Read the
  // body rather than re-deriving it so this never has to know the shape of
  // a faithfulness-gate rejection vs. a real answer; either way, whatever
  // the caller sees is exactly what gets saved.
  try {
    const data = (await response.clone().json()) as Record<string, unknown> & { error?: string; document?: string };
    const db = getDb();
    const now = new Date();
    const isSuccess = response.ok && typeof data.document === "string";
    await db.insert(draftDocuments).values({
      id: crypto.randomUUID(),
      organizationId: identity.organizationId,
      userId: identity.userId,
      title,
      instructions,
      format,
      status: isSuccess ? "done" : "error",
      headline: isSuccess ? (data.headline as string | undefined) ?? null : null,
      narrative: isSuccess ? (data.narrative as string | undefined) ?? null : null,
      documentType: documentType || null,
      documentMarkdown: isSuccess ? (data.document as string) : null,
      metricsJson: isSuccess ? JSON.stringify(data.metrics ?? []) : "[]",
      chartJson: isSuccess && data.chart ? JSON.stringify(data.chart) : null,
      confidence: isSuccess ? (data.confidence as string | undefined) ?? null : null,
      errorMessage: isSuccess ? null : data.error ?? "The draft could not be generated.",
      moduleLabel: focusedModule?.label ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error("draft_document_persist_failed", err);
  }

  return response;
}
