import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, oauthStates } from "@/db/schema";
import { encryptSecret } from "@/lib/integrations/crypto";
import { configuredEnvironment, getProvider } from "@/lib/integrations/catalog";
import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

const bindings = () => env as unknown as Record<string, string | undefined>;

function randomBase64Url(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function oauthUrl(provider: string, origin: string, state: string, verifier: string) {
  const config = bindings();
  const redirectUri = `${origin}/api/oauth/callback`;
  const challenge = sha256Base64Url(verifier);
  if (provider === "slack") {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.search = new URLSearchParams({ client_id: config.SLACK_CLIENT_ID ?? "", scope: "channels:history,channels:read,chat:write,users:read", redirect_uri: redirectUri, state }).toString();
    return Promise.resolve(url.toString());
  }
  if (provider === "notion") {
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.search = new URLSearchParams({ client_id: config.NOTION_CLIENT_ID ?? "", response_type: "code", owner: "user", redirect_uri: redirectUri, state }).toString();
    return Promise.resolve(url.toString());
  }
  if (provider === "outlook") {
    const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    return challenge.then((codeChallenge) => {
      url.search = new URLSearchParams({ client_id: config.MICROSOFT_CLIENT_ID ?? "", response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: "offline_access User.Read Mail.Read Calendars.Read", state, code_challenge: codeChallenge, code_challenge_method: "S256" }).toString();
      return url.toString();
    });
  }
  if (provider === "gmail") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    return challenge.then((codeChallenge) => {
      url.search = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID ?? "", response_type: "code", redirect_uri: redirectUri, scope: "https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", prompt: "consent", state, code_challenge: codeChallenge, code_challenge_method: "S256" }).toString();
      return url.toString();
    });
  }
  if (provider === "xero") {
    const url = new URL("https://login.xero.com/identity/connect/authorize");
    url.search = new URLSearchParams({ client_id: config.XERO_CLIENT_ID ?? "", response_type: "code", redirect_uri: redirectUri, scope: "openid profile email offline_access accounting.invoices.read accounting.payments.read accounting.banktransactions.read accounting.contacts.read accounting.settings.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read", state }).toString();
    return Promise.resolve(url.toString());
  }
  if (provider === "quickbooks") {
    const url = new URL("https://appcenter.intuit.com/connect/oauth2");
    url.search = new URLSearchParams({ client_id: config.QUICKBOOKS_CLIENT_ID ?? "", response_type: "code", redirect_uri: redirectUri, scope: "com.intuit.quickbooks.accounting", state }).toString();
    return Promise.resolve(url.toString());
  }
  throw new Error("Unsupported OAuth provider");
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: string; credentials?: Record<string, string>; returnTo?: string };
  const provider = getProvider(body.provider ?? "");
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 400 });
  await ensureOrganization(identity);
  const db = getDb();
  const now = new Date();

  if (provider.authMode === "oauth2") {
    if (!configuredEnvironment(provider, bindings())) {
      return Response.json({ error: "OAuth application credentials are not configured", required: provider.env }, { status: 409 });
    }
    const state = randomBase64Url(36);
    const verifier = randomBase64Url(48);
    const requestedReturnTo = body.returnTo?.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/?view=connections";
    await db.insert(oauthStates).values({ state, organizationId: identity.organizationId, provider: provider.id, userId: identity.userId, codeVerifier: verifier, returnTo: requestedReturnTo, expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdAt: now });
    return Response.json({ authorizationUrl: await oauthUrl(provider.id, new URL(request.url).origin, state, verifier) });
  }

  if (!body.credentials) {
    return Response.json({ provider: provider.id, fields: provider.credentialFields ?? [], note: provider.note }, { status: 200 });
  }
  const missing = (provider.credentialFields ?? []).filter((field) => !body.credentials?.[field.key]).map((field) => field.label);
  if (missing.length) return Response.json({ error: "Missing required credentials", missing }, { status: 400 });
  const encryptionKey = bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return Response.json({ error: "Credential encryption is not configured" }, { status: 409 });
  const encrypted = await encryptSecret(JSON.stringify(body.credentials), encryptionKey);
  const status = provider.id === "telegram" || provider.id === "granola" ? "verification_required" : "setup_required";
  const connection = {
    id: crypto.randomUUID(),
    organizationId: identity.organizationId,
    provider: provider.id,
    category: provider.category,
    status,
    authMode: provider.authMode,
    scopesJson: JSON.stringify(provider.permissions),
    accessTokenCiphertext: encrypted,
    metadataJson: JSON.stringify({ readOnly: provider.readOnly, webhook: provider.webhook }),
    createdBy: identity.userId,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(integrationConnections).values(connection).onConflictDoUpdate({
    target: [integrationConnections.organizationId, integrationConnections.provider],
    set: { status, authMode: provider.authMode, scopesJson: connection.scopesJson, accessTokenCiphertext: encrypted, metadataJson: connection.metadataJson, updatedAt: now },
  });
  const [stored] = await db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, identity.organizationId), eq(integrationConnections.provider, provider.id))).limit(1);
  return Response.json({ connection: { id: stored?.id ?? connection.id, provider: provider.id, status }, next: provider.note });
}
