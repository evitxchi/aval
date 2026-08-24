import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { draftDocuments } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";

/** Every persisted Ask Aval Tasks draft for this org, newest first — hydrates the client on load so a refresh doesn't lose them. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select()
    .from(draftDocuments)
    .where(eq(draftDocuments.organizationId, identity.organizationId))
    .orderBy(desc(draftDocuments.createdAt));

  return Response.json({
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      instructions: row.instructions,
      format: row.format,
      status: row.status,
      headline: row.headline,
      document: row.documentMarkdown,
      metrics: JSON.parse(row.metricsJson || "[]"),
      confidence: row.confidence,
      error: row.errorMessage,
      sentTo: row.sentTo,
      moduleLabel: row.moduleLabel,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
    })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; sentTo?: string };
  if (!body.id || !body.sentTo) return Response.json({ error: "id and sentTo are required" }, { status: 400 });

  const db = getDb();
  await db
    .update(draftDocuments)
    .set({ sentTo: body.sentTo, updatedAt: new Date() })
    .where(and(eq(draftDocuments.id, body.id), eq(draftDocuments.organizationId, identity.organizationId)));

  return Response.json({ ok: true });
}
