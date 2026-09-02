import { getApiIdentity } from "@/lib/integrations/session";
import { deleteCustomPersona } from "@/lib/ask-aval/custom-personas";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  await deleteCustomPersona(identity.organizationId, id);
  return Response.json({ ok: true });
}
