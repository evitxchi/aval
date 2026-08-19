import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, oauthStates } from "@/db/schema";
import { encryptSecret } from "@/lib/integrations/crypto";
import { getProvider } from "@/lib/integrations/catalog";
import { getApiIdentity } from "@/lib/integrations/session";

const bindings = () => env as unknown as Record<string, string | undefined>;

function basic(clientId?: string, clientSecret?: string) {
  return `Basic ${btoa(`${clientId ?? ""}:${clientSecret ?? ""}`)}`;
}

async function exchange(provider: string, code: string, redirectUri: string, verifier: string | null) {
  const config = bindings();
  let url = "";
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (verifier) body.set("code_verifier", verifier);
  if (provider === "slack") {
    url = "https://slack.com/api/oauth.v2.access";
    body.set("client_id", config.SLACK_CLIENT_ID ?? "");
    body.set("client_secret", config.SLACK_CLIENT_SECRET ?? "");
  } else if (provider === "notion") {
    url = "https://api.notion.com/v1/oauth/token";
    headers.authorization = basic(config.NOTION_CLIENT_ID, config.NOTION_CLIENT_SECRET);
    headers["content-type"] = "application/json";
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
    return parseTokenResponse(response);
  } else if (provider === "outlook") {
    url = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
    body.set("client_id", config.MICROSOFT_CLIENT_ID ?? "");
    body.set("client_secret", config.MICROSOFT_CLIENT_SECRET ?? "");
    body.set("scope", "offline_access User.Read Mail.Read Calendars.Read");
  } else if (provider === "gmail") {
    url = "https://oauth2.googleapis.com/token";
    body.set("client_id", config.GOOGLE_CLIENT_ID ?? "");
    body.set("client_secret", config.GOOGLE_CLIENT_SECRET ?? "");
  } else if (provider === "xero") {
    url = "https://identity.xero.com/connect/token";
    headers.authorization = basic(config.XERO_CLIENT_ID, config.XERO_CLIENT_SECRET);
  } else if (provider === "quickbooks") {
    url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    headers.authorization = basic(config.QUICKBOOKS_CLIENT_ID, config.QUICKBOOKS_CLIENT_SECRET);
  } else {
    throw new Error("Unsupported OAuth provider");
  }
  return parseTokenResponse(await fetch(url, { method: "POST", headers, body }));
}

async function parseTokenResponse(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") throw new Error(typeof data.error_description === "string" ? data.error_description : "OAuth token exchange failed");
  return data;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateValue = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!stateValue || !code) return Response.json({ error: url.searchParams.get("error_description") ?? "Missing OAuth callback parameters" }, { status: 400 });
  const identity = await getApiIdentity(request);
  if (!identity) return Response.redirect(`${url.origin}/signin-with-chatgpt?return_to=${encodeURIComponent(url.pathname + url.search)}`);
  const db = getDb();
  const [state] = await db.select().from(oauthStates).where(and(eq(oauthStates.state, stateValue), eq(oauthStates.userId, identity.userId))).limit(1);
  if (!state || state.expiresAt.getTime() < Date.now()) return Response.json({ error: "OAuth state is invalid or expired" }, { status: 400 });
  const provider = getProvider(state.provider);
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 400 });
  const encryptionKey = bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return Response.json({ error: "Credential encryption is not configured" }, { status: 500 });
  try {
    const token = await exchange(provider.id, code, `${url.origin}/api/oauth/callback`, state.codeVerifier);
    const accessTokenCiphertext = await encryptSecret(String(token.access_token), encryptionKey);
    const refreshTokenCiphertext = typeof token.refresh_token === "string" ? await encryptSecret(token.refresh_token, encryptionKey) : null;
    const expiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000) : null;
    const now = new Date();
    const externalAccountName = typeof token.workspace_name === "string" ? token.workspace_name : typeof token.team_name === "string" ? token.team_name : null;
    await db.insert(integrationConnections).values({
      id: crypto.randomUUID(), organizationId: state.organizationId, provider: provider.id, category: provider.category, status: "connected", authMode: provider.authMode,
      externalAccountName, scopesJson: JSON.stringify(provider.permissions), accessTokenCiphertext, refreshTokenCiphertext, expiresAt,
      metadataJson: JSON.stringify({ readOnly: provider.readOnly, webhook: provider.webhook }), createdBy: identity.userId, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({ target: [integrationConnections.organizationId, integrationConnections.provider], set: { status: "connected", externalAccountName, accessTokenCiphertext, refreshTokenCiphertext, expiresAt, updatedAt: now } });
    await db.delete(oauthStates).where(eq(oauthStates.state, stateValue));
    const redirect = new URL(state.returnTo, url.origin);
    redirect.searchParams.set("connected", provider.id);
    return Response.redirect(redirect.toString());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "OAuth connection failed" }, { status: 502 });
  }
}
