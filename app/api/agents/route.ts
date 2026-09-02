import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { createCustomPersona, listCustomPersonas, InvalidPersonaInputError } from "@/lib/ask-aval/custom-personas";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const personas = await listCustomPersonas(identity.organizationId);
  return Response.json({ personas });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as {
    label?: string;
    focusDescription?: string;
    toolNames?: string[];
    shape?: string;
    theme?: string;
  };

  try {
    const persona = await createCustomPersona(identity.organizationId, identity.userId, {
      label: typeof body.label === "string" ? body.label : "",
      focusDescription: typeof body.focusDescription === "string" ? body.focusDescription : "",
      toolNames: Array.isArray(body.toolNames) ? body.toolNames.filter((name) => typeof name === "string") : null,
      shape: typeof body.shape === "string" ? body.shape : "",
      theme: typeof body.theme === "string" ? body.theme : "",
    });
    return Response.json({ persona }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidPersonaInputError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
