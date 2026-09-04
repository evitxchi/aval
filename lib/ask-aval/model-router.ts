/**
 * Resolves which model actually answers a given org's Ask Aval/agent calls:
 * either Aval's own bundled Anthropic key (the default, unchanged from
 * before this file existed), a model provider the org connected with its
 * own API key, or a Claude/ChatGPT subscription the org connected via
 * OAuth (see lib/integrations/subscription-oauth.ts). Every caller that
 * used to call `callClaude` directly (loop.ts, bill-extraction.ts) now
 * calls `callModel(env, orgId, params)` instead — same params shape, same
 * MessagesResponse/AnthropicError contract, so nothing downstream needed
 * to change.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, organizations } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { getProvider } from "@/lib/integrations/catalog";
import { codexInstallationId, isCredentialFresh, isSubscriptionProviderId, refreshSubscriptionCredential, type SubscriptionProviderId } from "@/lib/integrations/subscription-oauth";
import { callClaude, type AskAvalEnv, type Message, type MessagesResponse, type ToolSchema } from "./anthropic";
import { callOpenAiCompatible } from "./openai-compatible";
import { callClaudeOAuth } from "./claude-oauth";
import { callChatgptOAuth } from "./chatgpt-oauth";

interface CallParams {
  system: string;
  messages: Message[];
  tools?: ToolSchema[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  max_tokens?: number;
  timeout_ms?: number;
  /** Set from the workspace's saved setting; only the flagship GPT-5.6 models accept it. */
  reasoningEffort?: string;
}

type Override =
  | { kind: "api_key"; providerId: string; apiKey: string; model?: string }
  | { kind: "subscription"; providerId: SubscriptionProviderId; accessToken: string; accountId?: string; model?: string; reasoningEffort?: string };

/**
 * A stale subscription access token gets refreshed here, once, before the
 * caller ever sees it — refreshed tokens are re-encrypted and written back
 * to this same connection row so the next call in this org doesn't repeat
 * the refresh round-trip. Any failure anywhere in this file (no override
 * set, key/token missing or undecryptable, refresh failing, encryption key
 * not configured) silently falls back to Aval's own key — a broken
 * override should never take an org's assistant down.
 */
async function resolveOverride(env: AskAvalEnv, orgId: string): Promise<Override | null> {
  const encryptionKey = (env as unknown as Record<string, string | undefined>).INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return null;

  const db = getDb();
  const [org] = await db.select({ activeModelProvider: organizations.activeModelProvider }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org?.activeModelProvider) return null;

  const [connection] = await db.select({
    id: integrationConnections.id,
    authMode: integrationConnections.authMode,
    status: integrationConnections.status,
    accessTokenCiphertext: integrationConnections.accessTokenCiphertext,
    refreshTokenCiphertext: integrationConnections.refreshTokenCiphertext,
    expiresAt: integrationConnections.expiresAt,
    externalAccountId: integrationConnections.externalAccountId,
    metadataJson: integrationConnections.metadataJson,
  }).from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, org.activeModelProvider)))
    .limit(1);
  if (!connection?.accessTokenCiphertext || connection.status !== "connected") return null;

  if (connection.authMode === "oauth_subscription_paste" && isSubscriptionProviderId(org.activeModelProvider)) {
    const providerId = org.activeModelProvider;
    const metadata = (() => { try { return JSON.parse(connection.metadataJson || "{}") as { model?: string; reasoningEffort?: string }; } catch { return {}; } })();
    const model = metadata.model;
    const reasoningEffort = metadata.reasoningEffort;
    try {
      if (connection.expiresAt && isCredentialFresh(connection.expiresAt)) {
        return { kind: "subscription", providerId, accessToken: await decryptSecret(connection.accessTokenCiphertext, encryptionKey), accountId: connection.externalAccountId ?? undefined, model, reasoningEffort };
      }
      if (!connection.refreshTokenCiphertext) return null;
      const refreshToken = await decryptSecret(connection.refreshTokenCiphertext, encryptionKey);
      const refreshed = await refreshSubscriptionCredential(providerId, refreshToken);
      const now = new Date();
      await db.update(integrationConnections).set({
        accessTokenCiphertext: await encryptSecret(refreshed.access, encryptionKey),
        refreshTokenCiphertext: await encryptSecret(refreshed.refresh, encryptionKey),
        expiresAt: refreshed.expiresAt,
        externalAccountId: refreshed.accountId ?? connection.externalAccountId,
        updatedAt: now,
      }).where(eq(integrationConnections.id, connection.id));
      return { kind: "subscription", providerId, accessToken: refreshed.access, accountId: refreshed.accountId ?? connection.externalAccountId ?? undefined, model, reasoningEffort };
    } catch (err) {
      console.error("model_router_subscription_refresh_failed", providerId, err);
      return null;
    }
  }

  try {
    const credentials = JSON.parse(await decryptSecret(connection.accessTokenCiphertext, encryptionKey)) as { apiKey?: string; model?: string };
    if (!credentials.apiKey) return null;
    return { kind: "api_key", providerId: org.activeModelProvider, apiKey: credentials.apiKey, model: credentials.model || undefined };
  } catch (err) {
    console.error("model_router_decrypt_failed", org.activeModelProvider, err);
    return null;
  }
}

export async function callModel(env: AskAvalEnv, orgId: string, params: CallParams): Promise<MessagesResponse> {
  const override = await resolveOverride(env, orgId);
  if (!override) {
    const model = env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
    return withRouting(await callClaude(env, params), "anthropic", model);
  }

  if (override.kind === "subscription") {
    if (override.providerId === "claude") {
      const model = override.model ?? "claude-sonnet-5";
      return withRouting(await callClaudeOAuth(override.accessToken, { ...params, model }), "claude", model);
    }
    const model = override.model ?? "gpt-5.1-codex";
    return withRouting(await callChatgptOAuth(override.accessToken, override.accountId, {
      ...params,
      model,
      reasoningEffort: override.reasoningEffort ?? params.reasoningEffort,
      // Derived from the org id so it is stable per workspace — a fresh id
      // on every call would look like a new install each time.
      installationId: await codexInstallationId(orgId),
    }), "chatgpt", model);
  }

  if (override.providerId === "anthropic") {
    const model = override.model ?? getProvider("anthropic")?.defaultModel ?? "claude-sonnet-5";
    return withRouting(await callClaude({ ...env, ANTHROPIC_API_KEY: override.apiKey, ANTHROPIC_MODEL: model }, params), "anthropic", model);
  }

  const catalogEntry = getProvider(override.providerId);
  const model = override.model ?? catalogEntry?.defaultModel;
  if (!catalogEntry?.baseUrl || !model) {
    const fallbackModel = env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
    return withRouting(await callClaude(env, params), "anthropic", fallbackModel);
  }
  return withRouting(
    await callOpenAiCompatible({ baseUrl: catalogEntry.baseUrl, apiKey: override.apiKey, model, providerLabel: catalogEntry.title }, params),
    override.providerId,
    model,
  );
}

function withRouting(response: MessagesResponse, providerId: string, model: string): MessagesResponse {
  return { ...response, routing: { providerId, model } };
}
