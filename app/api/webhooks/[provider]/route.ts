import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, integrationConnections, integrationEvents, messages } from "@/db/schema";
import { decryptSecret } from "@/lib/integrations/crypto";
import { constantTimeEqual } from "@/lib/security/constant-time";
import { parseInboundMessage } from "@/lib/integrations/inbound";
import { draftAutoReply } from "@/lib/ask-aval/auto-reply";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";
import { getRequestExecutionContext } from "vinext/shims/request-context";

const encoder = new TextEncoder();
const bindings = () => env as unknown as Record<string, string | undefined>;

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, value: string, algorithm: "SHA-256" | "SHA-1" = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function connectionCredential(request: Request, provider: string, key: string) {
  const connectionId = new URL(request.url).searchParams.get("connection");
  const encryptionKey = bindings().INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!connectionId || !encryptionKey) return null;
  const [connection] = await getDb().select({ encrypted: integrationConnections.accessTokenCiphertext }).from(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.provider, provider))).limit(1);
  if (!connection?.encrypted) return null;
  const credentials = JSON.parse(await decryptSecret(connection.encrypted, encryptionKey)) as Record<string, string>;
  return credentials[key] ?? null;
}

async function verify(provider: string, request: Request, raw: string) {
  const config = bindings();
  if (provider === "slack") {
    const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
    const signature = request.headers.get("x-slack-signature") ?? "";
    if (!config.SLACK_SIGNING_SECRET || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    return constantTimeEqual(signature, `v0=${hex(await hmac(config.SLACK_SIGNING_SECRET, `v0:${timestamp}:${raw}`))}`);
  }
  if (provider === "whatsapp") {
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    if (!config.META_WHATSAPP_APP_SECRET) return false;
    return constantTimeEqual(signature, `sha256=${hex(await hmac(config.META_WHATSAPP_APP_SECRET, raw))}`);
  }
  if (provider === "telegram") {
    const secret = await connectionCredential(request, provider, "webhookSecret") ?? config.TELEGRAM_WEBHOOK_SECRET;
    return Boolean(secret) && constantTimeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", secret ?? "");
  }
  if (provider === "apple_messages") {
    const secret = await connectionCredential(request, provider, "webhookSecret") ?? config.APPLE_MSP_WEBHOOK_SECRET;
    const signature = request.headers.get("x-aval-webhook-secret") ?? request.headers.get("x-portero-webhook-secret") ?? "";
    return Boolean(secret) && constantTimeEqual(signature, secret ?? "");
  }
  if (provider === "twilio") {
    const secret = await connectionCredential(request, provider, "authToken") ?? config.TWILIO_AUTH_TOKEN;
    const signature = request.headers.get("x-twilio-signature") ?? "";
    if (!secret || !signature) return false;
    const params = new URLSearchParams(raw);
    const payload = request.url + [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}${value}`).join("");
    return constantTimeEqual(signature, base64(await hmac(secret, payload, "SHA-1")));
  }
  return false;
}

/**
 * Resolves which organization an inbound message belongs to. Telegram and
 * Apple Messages webhook URLs are already scoped to one connection (set at
 * verify time, see app/api/integrations/verify/route.ts); Slack, WhatsApp,
 * and Twilio share one webhook URL across every org, so those are matched
 * by the account-identifying field each connection stored at connect/verify
 * time (team id, phone_number_id, AccountSid).
 */
async function resolveOrganizationId(provider: string, connectionId: string | undefined, externalAccountKey: string | undefined): Promise<string | null> {
  const db = getDb();
  if (connectionId) {
    const [connection] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.provider, provider))).limit(1);
    return connection?.organizationId ?? null;
  }
  if (externalAccountKey) {
    const [connection] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(eq(integrationConnections.provider, provider), eq(integrationConnections.externalAccountId, externalAccountKey))).limit(1);
    return connection?.organizationId ?? null;
  }
  return null;
}

/**
 * Persists the inbound message (conversations/messages, previously defined
 * but never written to), then drafts a reply the moment it lands rather
 * than waiting for a human to open the thread. Scheduled via waitUntil so
 * the webhook provider gets its ack immediately; the LLM call happens
 * after the response is already on the wire. On plain Node (local dev),
 * getRequestExecutionContext() is null, so this falls back to a detached,
 * best-effort promise instead.
 */
async function ingestInboundMessage(provider: string, organizationId: string, parsed: { externalThreadId: string; externalMessageId: string; contactDisplayName: string; body: string }, env: AskAvalEnv) {
  const db = getDb();
  const now = new Date();
  await db.insert(conversations).values({
    id: crypto.randomUUID(),
    organizationId,
    channel: provider,
    externalThreadId: parsed.externalThreadId,
    contactDisplayName: parsed.contactDisplayName,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [conversations.organizationId, conversations.channel, conversations.externalThreadId],
    set: { contactDisplayName: parsed.contactDisplayName, lastMessageAt: now, updatedAt: now },
  });
  const [conversation] = await db.select({ id: conversations.id, locale: conversations.locale }).from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.channel, provider), eq(conversations.externalThreadId, parsed.externalThreadId)))
    .limit(1);
  if (!conversation) return;

  const inserted = await db.insert(messages).values({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    externalMessageId: parsed.externalMessageId,
    direction: "inbound",
    body: parsed.body,
    createdAt: now,
  }).onConflictDoNothing().returning({ id: messages.id });
  // A retried webhook delivery for the same message id lands here as a
  // no-op insert — skip re-drafting (and re-spending a model call) for a
  // message that already has one.
  if (inserted.length === 0) return;

  const draftWork = (async () => {
    const result = await draftAutoReply(env, { orgId: organizationId, userId: "webhook" }, parsed.contactDisplayName, parsed.body, conversation.locale);
    await db.update(conversations).set({
      draftReply: result.ok ? (result.reply ?? null) : null,
      draftReplyStatus: result.ok ? "ready" : "failed",
      draftReplyAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(conversations.id, conversation.id));
  })().catch((error) => console.error("auto_reply_draft_failed", provider, error instanceof Error ? error.message : error));

  const ctx = getRequestExecutionContext();
  if (ctx) ctx.waitUntil(draftWork);
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const verifyToken = bindings().META_WHATSAPP_VERIFY_TOKEN;
  if (provider === "whatsapp" && verifyToken && url.searchParams.get("hub.mode") === "subscribe" && constantTimeEqual(url.searchParams.get("hub.verify_token") ?? "", verifyToken)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Not found", { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const raw = await request.text();
  if (!(await verify(provider, request, raw))) return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  const payload = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
    ? Object.fromEntries(new URLSearchParams(raw))
    : JSON.parse(raw || "{}") as Record<string, unknown>;
  if (provider === "slack" && payload.type === "url_verification") return Response.json({ challenge: payload.challenge });
  const externalEventId = String(payload.event_id ?? payload.update_id ?? request.headers.get("x-request-id") ?? crypto.randomUUID());
  const eventType = String(payload.type ?? (payload.event as Record<string, unknown> | undefined)?.type ?? "message");
  try {
    await getDb().insert(integrationEvents).values({ id: crypto.randomUUID(), provider, externalEventId, eventType, payloadJson: JSON.stringify(payload), status: "received", receivedAt: new Date() }).onConflictDoNothing();
  } catch (error) {
    console.error("Webhook persistence failed", provider, error instanceof Error ? error.message : error);
    return Response.json({ error: "Event storage unavailable" }, { status: 503 });
  }

  // Best-effort: a real inbound message that can't be attributed to a
  // known organization, or that fails to draft, should never turn a
  // successfully-received webhook into an error response to the provider.
  try {
    const connectionIdFromQuery = new URL(request.url).searchParams.get("connection");
    const parsed = parseInboundMessage(provider, payload, connectionIdFromQuery);
    if (parsed) {
      const organizationId = await resolveOrganizationId(provider, parsed.connectionId, parsed.externalAccountKey);
      if (organizationId) await ingestInboundMessage(provider, organizationId, parsed, env as unknown as AskAvalEnv);
    }
  } catch (error) {
    console.error("Inbound message ingestion failed", provider, error instanceof Error ? error.message : error);
  }

  return Response.json({ received: true }, { status: 202 });
}
