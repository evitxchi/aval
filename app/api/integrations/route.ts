import { connectionBlocker, integrationReadiness } from "@/lib/integrations/readiness";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, organizations } from "@/db/schema";
import { configuredEnvironment, integrationCatalog } from "@/lib/integrations/catalog";
import { isModelProviderId } from "@/lib/integrations/model-providers";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const bindings = env as unknown as Record<string, unknown>;
  try {
    const organization = await ensureOrganization(identity);
    const rows = await getDb().select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      status: integrationConnections.status,
      externalAccountName: integrationConnections.externalAccountName,
      lastSyncAt: integrationConnections.lastSyncAt,
      updatedAt: integrationConnections.updatedAt,
    }).from(integrationConnections).where(eq(integrationConnections.organizationId, identity.organizationId));
    const connectionByProvider = new Map(rows.map((row) => [row.provider, row]));
    return Response.json({
      activeModelProvider: organization.activeModelProvider ?? null,
      providers: integrationCatalog.map((provider) => ({
        ...provider,
        setupBlocker: connectionBlocker(provider.id) ?? undefined, readiness: integrationReadiness(provider.id), configured: !connectionBlocker(provider.id) && configuredEnvironment(provider, bindings),
        connection: connectionByProvider.get(provider.id) ?? null,
      })),
    });
  } catch (error) {
    return Response.json({
      activeModelProvider: null,
      providers: integrationCatalog.map((provider) => ({ ...provider, setupBlocker: connectionBlocker(provider.id) ?? undefined, readiness: integrationReadiness(provider.id), configured: !connectionBlocker(provider.id) && configuredEnvironment(provider, bindings), connection: null })),
      storage: "unavailable",
      detail: error instanceof Error ? error.message : "D1 is unavailable",
    });
  }
}

/** Sets which connected model provider powers agents/Ask Aval for this org. `{ provider: null }` reverts to Aval's own bundled key. */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: string | null };
  const provider = body.provider ?? null;
  if (provider !== null && !isModelProviderId(provider)) {
    return Response.json({ error: "Unknown model provider" }, { status: 400 });
  }
  const db = getDb();
  await ensureOrganization(identity);
  if (provider) {
    const [connected] = await db.select({ status: integrationConnections.status }).from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, identity.organizationId), eq(integrationConnections.provider, provider), eq(integrationConnections.status, "connected")))
      .limit(1);
    if (!connected) return Response.json({ error: "That provider isn't connected yet — verify a key for it first." }, { status: 409 });
  }
  await db.update(organizations).set({ activeModelProvider: provider, updatedAt: new Date() }).where(eq(organizations.id, identity.organizationId));
  return Response.json({ activeModelProvider: provider });
}
