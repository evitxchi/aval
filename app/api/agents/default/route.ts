import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { listCustomPersonas } from "@/lib/ask-aval/custom-personas";

const BUILT_IN_PERSONA_IDS = new Set(["general", "financial", "brokerage", "realEstate", "marketResearch", "maintenance", "riskAnalyst", "portfolioOutlook"]);

/** GET: which persona Ask Aval opens with by default for this org. Null means the built-in "general" persona. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const org = await ensureOrganization(identity);
  return Response.json({ defaultPersonaId: org.defaultPersonaId ?? null });
}

/** POST { personaId }: sets the org-wide default. `{ personaId: null }` reverts to "general". */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { personaId?: string | null };
  const personaId = body.personaId ?? null;

  if (personaId !== null && !BUILT_IN_PERSONA_IDS.has(personaId)) {
    const customPersonas = await listCustomPersonas(identity.organizationId);
    if (!customPersonas.some((persona) => persona.id === personaId)) {
      return Response.json({ error: "Unknown agent" }, { status: 400 });
    }
  }

  await ensureOrganization(identity);
  const db = getDb();
  await db.update(organizations).set({ defaultPersonaId: personaId, updatedAt: new Date() }).where(eq(organizations.id, identity.organizationId));
  return Response.json({ defaultPersonaId: personaId });
}
