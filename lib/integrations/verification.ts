import { basicAuth, providerJson, record, requiredString, safeSegment } from "./http";
import type { IntegrationEnv } from "./oauth";

export type VerifiedAccount = { accountId: string; accountName: string; metadata: Record<string, unknown> };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Provider returned an unexpected collection");
  return value;
}
function verified(accountId: string, accountName: string): VerifiedAccount {
  return { accountId, accountName, metadata: { api: "verified", verifiedAt: new Date().toISOString() } };
}

/** Small read probes prove access without importing data or asserting freshness. */
export async function verifyAdditionalCredentials(provider: string, credentials: Record<string, string>, config: IntegrationEnv): Promise<VerifiedAccount | null> {
  if (provider === "asana") {
    const user = record(record(await providerJson("https://app.asana.com/api/1.0/users/me", { headers: bearer(credentials.apiKey) })).data);
    return verified(requiredString(user.gid), requiredString(user.name));
  }
  if (provider === "rentvine") {
    const subdomain = credentials.subdomain?.trim().toLowerCase();
    if (!subdomain || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) throw new Error("Enter only your Rentvine account subdomain, without a URL.");
    list(await providerJson(`https://${subdomain}.rentvine.com/api/manager/properties`, { headers: { authorization: basicAuth(credentials.accessKey, credentials.secret) } }));
    return verified(subdomain, `${subdomain}.rentvine.com`);
  }
  if (provider === "propstack") {
    list(await providerJson("https://api.propstack.de/v1/units?per=1", { headers: { "X-API-KEY": credentials.apiKey } }));
    return verified("propstack", "Propstack account");
  }
  if (provider === "street") {
    const payload = record(await providerJson("https://street.co.uk/open-api/v1/properties?page[size]=1", { headers: { ...bearer(credentials.apiKey), accept: "application/vnd.api+json" } }));
    list(payload.data);
    return verified("street", "Street account");
  }
  if (provider === "gohighlevel") {
    const id = safeSegment(credentials.locationId);
    const location = record(record(await providerJson(`https://services.leadconnectorhq.com/locations/${id}`, { headers: { ...bearer(credentials.apiKey), Version: "v3" } })).location);
    if (requiredString(location.id) !== credentials.locationId) throw new Error("The provider returned a different location. Check the selected account.");
    return verified(requiredString(location.id), requiredString(location.name));
  }
  if (provider === "meta") {
    const version = config.META_GRAPH_API_VERSION;
    if (!version || !/^v\d+\.\d+$/.test(version)) throw new Error("A valid Meta Graph API version must be configured before verification.");
    const id = safeSegment(credentials.pageId);
    const headers = bearer(credentials.accessToken);
    const page = record(await providerJson(`https://graph.facebook.com/${version}/${id}?fields=id,name`, { headers }));
    if (requiredString(page.id) !== credentials.pageId) throw new Error("The provider returned a different Page. Check the selected account.");
    list(record(await providerJson(`https://graph.facebook.com/${version}/${id}/leadgen_forms?fields=id,name&limit=1`, { headers })).data);
    return verified(requiredString(page.id), requiredString(page.name));
  }
  return null;
}

/** OAuth identity alone does not prove access to the selected product. */
export async function verifyOAuthReadAccess(provider: string, accessToken: string): Promise<void> {
  const headers = bearer(accessToken);
  if (provider === "google_chat") {
    const payload = record(await providerJson("https://chat.googleapis.com/v1/spaces?pageSize=1", { headers }));
    // Google omits repeated fields when a collection is empty.
    list(payload.spaces ?? []);
  } else if (provider === "google_drive" || provider === "google_sheets") {
    const query = new URLSearchParams({ pageSize: "1", fields: "files(id,name,mimeType)", q: provider === "google_sheets" ? "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'" : "trashed = false" });
    list(record(await providerJson(`https://www.googleapis.com/drive/v3/files?${query}`, { headers })).files);
  } else if (provider === "microsoft_teams") {
    list(record(await providerJson("https://graph.microsoft.com/v1.0/me/chats?$top=1", { headers })).value);
  } else if (provider === "onedrive") {
    list(record(await providerJson("https://graph.microsoft.com/v1.0/me/drive/root/children?$top=1&$select=id,name", { headers })).value);
  } else if (provider === "box") {
    list(record(await providerJson("https://api.box.com/2.0/folders/0/items?limit=1&fields=id,name,type", { headers })).entries);
  }
}
