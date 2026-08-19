import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { configuredEnvironment, integrationCatalog } from "@/lib/integrations/catalog";
import { ensureOrganization, getApiIdentity } from "@/lib/integrations/session";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const bindings = env as unknown as Record<string, unknown>;
  try {
    await ensureOrganization(identity);
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
      providers: integrationCatalog.map((provider) => ({
        ...provider,
        configured: configuredEnvironment(provider, bindings),
        connection: connectionByProvider.get(provider.id) ?? null,
      })),
    });
  } catch (error) {
    return Response.json({
      providers: integrationCatalog.map((provider) => ({ ...provider, configured: configuredEnvironment(provider, bindings), connection: null })),
      storage: "unavailable",
      detail: error instanceof Error ? error.message : "D1 is unavailable",
    });
  }
}
