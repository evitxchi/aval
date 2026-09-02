import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, organizations } from "@/db/schema";
import { getProvider } from "@/lib/integrations/catalog";
import { getApiIdentity } from "@/lib/integrations/session";

/**
 * POST /api/integrations/reset
 * Disconnects a provider: clears its stored credentials and, if it was the
 * org's active model provider, reverts to Aval's own default. Mirrors
 * mentari2.0's per-provider "Reset" action.
 */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: string };
  const provider = getProvider(body.provider ?? "");
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 400 });

  const db = getDb();
  const now = new Date();
  await db.delete(integrationConnections).where(and(eq(integrationConnections.organizationId, identity.organizationId), eq(integrationConnections.provider, provider.id)));

  const [org] = await db.select({ activeModelProvider: organizations.activeModelProvider }).from(organizations).where(eq(organizations.id, identity.organizationId)).limit(1);
  if (org?.activeModelProvider === provider.id) {
    await db.update(organizations).set({ activeModelProvider: null, updatedAt: now }).where(eq(organizations.id, identity.organizationId));
  }

  return Response.json({ provider: provider.id, status: "disconnected" });
}
