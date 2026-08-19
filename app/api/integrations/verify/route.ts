import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getApiIdentity } from "@/lib/integrations/session";

const bindings = () => env as unknown as Record<string, string | undefined>;

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : `Provider returned ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

async function verifyCredentials(provider: string, credentials: Record<string, string>, request: Request, connectionId: string) {
  if (provider === "telegram") {
    const payload = await readJson(await fetch(`https://api.telegram.org/bot${credentials.botToken}/getMe`));
    const result = payload.result as Record<string, unknown> | undefined;
    const origin = new URL(request.url).origin;
    await readJson(await fetch(`https://api.telegram.org/bot${credentials.botToken}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${origin}/api/webhooks/telegram?connection=${encodeURIComponent(connectionId)}`, secret_token: credentials.webhookSecret, allowed_updates: ["message", "edited_message", "callback_query"] }),
    }));
    return { accountId: String(result?.id ?? ""), accountName: String(result?.username ?? "Telegram bot"), metadata: { webhook: "verified" } };
  }
  if (provider === "granola") {
    const payload = await readJson(await fetch("https://public-api.granola.ai/v1/notes", { headers: { authorization: `Bearer ${credentials.apiKey}` } }));
    return { accountId: "granola", accountName: "Granola workspace", metadata: { hasNotes: Array.isArray(payload.notes) && payload.notes.length > 0 } };
  }
  if (provider === "buildium") {
    await readJson(await fetch("https://api.buildium.com/v1/rentals", { headers: { "x-buildium-client-id": credentials.clientId, "x-buildium-client-secret": credentials.clientSecret } }));
    return { accountId: "buildium", accountName: "Buildium account", metadata: { api: "verified" } };
  }
  if (provider === "twilio") {
    const payload = await readJson(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`, { headers: { authorization: basic(credentials.accountSid, credentials.authToken) } }));
    return { accountId: String(payload.sid ?? credentials.accountSid), accountName: String(payload.friendly_name ?? "Twilio account"), metadata: { api: "verified" } };
  }
  if (provider === "whatsapp") {
    const version = credentials.graphApiVersion || bindings().META_GRAPH_API_VERSION;
    if (!version) throw new Error("A Meta Graph API version must be configured before verification.");
    const payload = await readJson(await fetch(`https://graph.facebook.com/${version}/${credentials.phoneNumberId}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${credentials.accessToken}` } }));
    return { accountId: String(payload.id ?? credentials.phoneNumberId), accountName: String(payload.verified_name ?? payload.display_phone_number ?? "WhatsApp number"), metadata: { businessAccountId: credentials.businessAccountId, apiVersion: version } };
  }
  if (provider === "appfolio") throw new Error("AppFolio must enable the agreed Stack API products before Aval can verify this database.");
  if (provider === "apple_messages") throw new Error("Apple Messages for Business verification is completed jointly with your approved Messaging Service Provider.");
  throw new Error("This provider is verified by its OAuth callback.");
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { connectionId?: string };
  if (!body.connectionId) return Response.json({ error: "Connection ID is required" }, { status: 400 });
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.id, body.connectionId), eq(integrationConnections.organizationId, identity.organizationId))).limit(1);
  if (!connection?.accessTokenCiphertext) return Response.json({ error: "Encrypted credentials were not found" }, { status: 404 });
  const encryptionKey = bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return Response.json({ error: "Credential encryption is not configured" }, { status: 500 });
  try {
    const credentials = JSON.parse(await decryptSecret(connection.accessTokenCiphertext, encryptionKey)) as Record<string, string>;
    const verified = await verifyCredentials(connection.provider, credentials, request, connection.id);
    const now = new Date();
    await db.update(integrationConnections).set({ status: "connected", externalAccountId: verified.accountId, externalAccountName: verified.accountName, metadataJson: JSON.stringify(verified.metadata), lastSyncAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id));
    return Response.json({ connection: { id: connection.id, provider: connection.provider, status: "connected", externalAccountName: verified.accountName } });
  } catch (error) {
    await db.update(integrationConnections).set({ status: "verification_failed", updatedAt: new Date() }).where(eq(integrationConnections.id, connection.id));
    return Response.json({ error: error instanceof Error ? error.message : "Provider verification failed" }, { status: 422 });
  }
}
