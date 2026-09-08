import { getProvider } from "./catalog";
import { basicAuth, providerJson, record, requiredString } from "./http";

export type IntegrationEnv = Record<string, string | undefined>;
type OAuthSpec = { authorize: string; token: string; client: string; secret: string; basic?: boolean; pkce?: boolean; separator?: string; json?: boolean; extra?: Record<string, string> };
const google: OAuthSpec = { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", client: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET", pkce: true, extra: { access_type: "offline", prompt: "consent" } };
const microsoft: OAuthSpec = { authorize: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token", client: "MICROSOFT_CLIENT_ID", secret: "MICROSOFT_CLIENT_SECRET", pkce: true };
export const OAUTH_SPECS: Readonly<Record<string, OAuthSpec>> = {
  gmail: google, google_chat: google, google_drive: google, google_sheets: google,
  outlook: microsoft, microsoft_teams: microsoft, onedrive: microsoft,
  slack: { authorize: "https://slack.com/oauth/v2/authorize", token: "https://slack.com/api/oauth.v2.access", client: "SLACK_CLIENT_ID", secret: "SLACK_CLIENT_SECRET", separator: "," },
  notion: { authorize: "https://api.notion.com/v1/oauth/authorize", token: "https://api.notion.com/v1/oauth/token", client: "NOTION_CLIENT_ID", secret: "NOTION_CLIENT_SECRET", basic: true, json: true, extra: { owner: "user" } },
  quickbooks: { authorize: "https://appcenter.intuit.com/connect/oauth2", token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", client: "QUICKBOOKS_CLIENT_ID", secret: "QUICKBOOKS_CLIENT_SECRET", basic: true },
  xero: { authorize: "https://login.xero.com/identity/connect/authorize", token: "https://identity.xero.com/connect/token", client: "XERO_CLIENT_ID", secret: "XERO_CLIENT_SECRET", basic: true },
  box: { authorize: "https://account.box.com/api/oauth2/authorize", token: "https://api.box.com/oauth2/token", client: "BOX_CLIENT_ID", secret: "BOX_CLIENT_SECRET" },
  reapit: { authorize: "https://connect.reapit.cloud/authorize", token: "https://connect.reapit.cloud/token", client: "REAPIT_CLIENT_ID", secret: "REAPIT_CLIENT_SECRET", basic: true },
  arthur: { authorize: "https://auth.arthuronline.co.uk/oauth/authorize", token: "https://auth.arthuronline.co.uk/oauth/token", client: "ARTHUR_CLIENT_ID", secret: "ARTHUR_CLIENT_SECRET" },
};
export function oauthScopes(provider: string): string[] {
  const permissions = getProvider(provider)?.permissions ?? [];
  if (OAUTH_SPECS[provider] === google) return ["openid", "email", ...permissions.map((scope) => scope === "gmail.readonly" ? "https://www.googleapis.com/auth/gmail.readonly" : scope)];
  if (provider === "notion") return [];
  return permissions;
}
export function safeReturnTo(value: unknown, origin: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || (value.includes("\\") || Array.from(value).some((char) => char.charCodeAt(0) < 32))) return "/?view=connections";
  const parsed = new URL(value, origin);
  return parsed.origin === origin ? parsed.pathname + parsed.search : "/?view=connections";
}
export async function authorizationUrl(provider: string, config: IntegrationEnv, origin: string, state: string, verifier: string): Promise<string> {
  const spec = OAUTH_SPECS[provider];
  if (!spec || !config[spec.client] || !config[spec.secret]) throw new Error("OAuth application credentials are not configured");
  const url = new URL(spec.authorize);
  url.search = new URLSearchParams({ response_type: "code", client_id: config[spec.client]!, redirect_uri: `${origin}/api/oauth/callback`, state, ...spec.extra }).toString();
  const scopes = oauthScopes(provider);
  if (scopes.length) url.searchParams.set("scope", scopes.join(spec.separator ?? " "));
  if (spec.pkce) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    url.searchParams.set("code_challenge", btoa(String.fromCharCode(...hash)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}
export type OAuthToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; [key: string]: unknown };
export async function requestOAuthToken(provider: string, config: IntegrationEnv, values: Record<string, string>): Promise<OAuthToken> {
  const spec = OAUTH_SPECS[provider];
  if (!spec || !config[spec.client] || !config[spec.secret]) throw new Error("OAuth application credentials are not configured");
  const body = { ...values };
  const headers: Record<string, string> = { accept: "application/json", "content-type": spec.json ? "application/json" : "application/x-www-form-urlencoded" };
  if (!spec.pkce) delete body.code_verifier;
  if (spec.basic) headers.authorization = basicAuth(config[spec.client]!, config[spec.secret]!);
  else { body.client_id = config[spec.client]!; body.client_secret = config[spec.secret]!; }
  const data = record(await providerJson(spec.token, { method: "POST", headers, body: spec.json ? JSON.stringify(body) : new URLSearchParams(body) }));
  if (typeof data.access_token !== "string" || (data.refresh_token !== undefined && typeof data.refresh_token !== "string") || (data.scope !== undefined && typeof data.scope !== "string")) throw new Error("Provider returned invalid token fields");
  const access = requiredString(data.access_token, "access token", 16000);
  if (data.refresh_token !== undefined) requiredString(data.refresh_token, "refresh token", 16000);
  if (data.expires_in !== undefined && (!Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0)) throw new Error("Provider returned an invalid token lifetime");
  if (values.grant_type === "authorization_code" && typeof data.scope === "string" && provider !== "quickbooks" && provider !== "notion") {
    const granted = new Set(data.scope.split(/[ ,]+/));
    const missing = oauthScopes(provider).filter((scope) => !["openid", "email", "profile", "offline_access"].includes(scope) && !granted.has(scope));
    if (missing.length) throw new Error("The required read permissions were not granted. Reconnect and approve the listed scopes.");
  }
  return { ...data, access_token: access, ...(data.expires_in !== undefined ? { expires_in: Number(data.expires_in) } : {}) } as OAuthToken;
}

export async function oauthAccount(provider: string, token: OAuthToken, realmId: string | null, config: IntegrationEnv): Promise<{ id: string; name: string }> {
  const headers = { authorization: `Bearer ${token.access_token}` };
  if (provider === "quickbooks") {
    if (!realmId || !/^\d{1,32}$/.test(realmId)) throw new Error("QuickBooks did not return a valid company realm. Reconnect and choose a company.");
    const host = config.QUICKBOOKS_ENVIRONMENT === "sandbox" ? "sandbox-quickbooks.api.intuit.com" : "quickbooks.api.intuit.com";
    const company = record(record(await providerJson(`https://${host}/v3/company/${realmId}/companyinfo/${realmId}`, { headers })).CompanyInfo);
    return { id: realmId, name: requiredString(company.CompanyName, "company name") };
  }
  if (provider === "slack") { const team = record(token.team); return { id: requiredString(team.id), name: requiredString(team.name) }; }
  if (provider === "notion") return { id: requiredString(token.workspace_id), name: requiredString(token.workspace_name ?? "Notion workspace") };
  if (provider === "xero") {
    const tenants = await providerJson("https://api.xero.com/connections", { headers });
    if (!Array.isArray(tenants) || tenants.length !== 1) throw new Error("Authorize exactly one Xero organisation for this connection, then retry.");
    const tenant = record(tenants[0]); return { id: requiredString(tenant.tenantId), name: requiredString(tenant.tenantName) };
  }
  if (OAUTH_SPECS[provider] === google) {
    const user = record(await providerJson("https://openidconnect.googleapis.com/v1/userinfo", { headers }));
    return { id: requiredString(user.sub), name: requiredString(user.email ?? user.sub) };
  }
  if (OAUTH_SPECS[provider] === microsoft) {
    const user = record(await providerJson("https://graph.microsoft.com/v1.0/me?$select=id,displayName", { headers }));
    return { id: requiredString(user.id), name: requiredString(user.displayName ?? user.id) };
  }
  if (provider === "box") {
    const user = record(await providerJson("https://api.box.com/2.0/users/me", { headers }));
    return { id: requiredString(user.id), name: requiredString(user.name ?? user.login) };
  }
  // For APIs without a verified identity endpoint, authorization alone does
  // not establish a usable account. The connection must pass a read probe.
  return { id: "", name: getProvider(provider)?.title ?? provider };
}
