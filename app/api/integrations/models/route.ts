import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getProvider } from "@/lib/integrations/catalog";
import { isModelProviderId, listModels } from "@/lib/integrations/model-providers";
import { isSubscriptionProviderId } from "@/lib/integrations/subscription-oauth";
import { getApiIdentity } from "@/lib/integrations/session";

const bindings = () => env as unknown as Record<string, string | undefined>;

/**
 * GET /api/integrations/models?provider=X
 * The real, live list of models a connected provider currently offers —
 * backs Settings → Intelligence's "Model being used" picker. Requires the
 * org to already have a connected credential for that provider; there's
 * nothing to list a model catalog against otherwise.
 */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const providerId = new URL(request.url).searchParams.get("provider") ?? "";
  if (!isModelProviderId(providerId)) return Response.json({ error: "Unknown provider" }, { status: 400 });
  const catalogEntry = getProvider(providerId);
  if (!catalogEntry) return Response.json({ error: "Unknown provider" }, { status: 400 });

  const encryptionKey = bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return Response.json({ error: "Credential encryption is not configured" }, { status: 409 });

  const db = getDb();
  const [connection] = await db.select({ accessTokenCiphertext: integrationConnections.accessTokenCiphertext, status: integrationConnections.status })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, identity.organizationId), eq(integrationConnections.provider, providerId)))
    .limit(1);
  if (!connection?.accessTokenCiphertext || connection.status !== "connected") {
    return Response.json({ error: "Connect this provider before listing its models." }, { status: 409 });
  }

  try {
    const decrypted = await decryptSecret(connection.accessTokenCiphertext, encryptionKey);
    const accessToken = isSubscriptionProviderId(providerId) ? decrypted : (JSON.parse(decrypted) as { apiKey?: string }).apiKey;
    if (!accessToken) return Response.json({ error: "No credential is stored for this provider." }, { status: 409 });
    const models = await listModels(providerId, accessToken);
    return Response.json({ provider: providerId, models, defaultModel: catalogEntry.defaultModel ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not list models for this provider." }, { status: 502 });
  }
}
