import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { oauthStates } from "@/db/schema";
import { getProvider } from "@/lib/integrations/catalog";
import { isSubscriptionProviderId, startSubscriptionAuthorize } from "@/lib/integrations/subscription-oauth";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

const bindings = () => env as unknown as Record<string, string | undefined>;

/**
 * POST /api/integrations/subscription/start
 * Begins connecting a Claude Pro/Max or ChatGPT Plus/Pro subscription (see
 * lib/integrations/subscription-oauth.ts for exactly what this does and
 * why). Reuses the same `oauth_states` PKCE-verifier storage every other
 * OAuth provider in this app already uses — the only difference from those
 * is what happens after (see .../complete/route.ts): the user pastes back
 * what they see rather than the browser redirecting to a server Aval runs.
 */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: string };
  if (!body.provider || !isSubscriptionProviderId(body.provider)) return Response.json({ error: "Unknown subscription provider" }, { status: 400 });
  if (!bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY) return Response.json({ error: "Credential encryption is not configured" }, { status: 409 });
  const provider = getProvider(body.provider);
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 400 });
  await ensureOrganization(identity);

  const session = await startSubscriptionAuthorize(body.provider);
  const db = getDb();
  await db.insert(oauthStates).values({
    state: session.state,
    organizationId: identity.organizationId,
    provider: provider.id,
    userId: identity.userId,
    codeVerifier: session.verifier,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
  });
  return Response.json({ authorizeUrl: session.authorizeUrl, state: session.state });
}
