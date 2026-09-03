import { env } from "cloudflare:workers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { getDocument } from "@/lib/documents/store";
import { extractDocumentFinancials, fieldsForKind } from "@/lib/documents/extraction";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";

/**
 * POST /api/documents/extract { documentId }
 *
 * Reads a stored document and reports the fields its kind is checked for.
 * The document is fetched server-side by id rather than accepted in the
 * request body, so a caller can only extract from a document their own
 * organization already holds.
 */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as { documentId?: string };
  if (!body.documentId) return Response.json({ error: "A document id is required" }, { status: 400 });

  const document = await getDocument(identity.organizationId, body.documentId);
  if (!document) return Response.json({ error: "Document not found" }, { status: 404 });

  return extractDocumentFinancials(
    document.contentText,
    document.kind,
    env as unknown as AskAvalEnv,
    { orgId: identity.organizationId, userId: identity.userId },
  );
}

/** GET /api/documents/extract?kind=… — the fields a kind is checked for, shown before running. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const kindParam = new URL(request.url).searchParams.get("kind") ?? "other";
  const { isDocumentKind } = await import("@/lib/documents/types");
  const kind = isDocumentKind(kindParam) ? kindParam : "other";
  return Response.json({ kind, fields: fieldsForKind(kind) });
}
