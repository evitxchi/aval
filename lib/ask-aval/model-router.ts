/**
 * Resolves which model actually answers a given org's Ask Aval/agent calls:
 * either Aval's own bundled Anthropic key (the default, unchanged from
 * before this file existed) or a model provider the org connected itself
 * in Settings → Intelligence (lib/integrations/catalog.ts, category
 * "Model"). Every caller that used to call `callClaude` directly
 * (loop.ts, bill-extraction.ts) now calls `callModel(env, orgId, params)`
 * instead — same params shape, same MessagesResponse/AnthropicError
 * contract, so nothing downstream needed to change.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, organizations } from "@/db/schema";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getProvider } from "@/lib/integrations/catalog";
import { callClaude, type AskAvalEnv, type Message, type MessagesResponse, type ToolSchema } from "./anthropic";
import { callOpenAiCompatible } from "./openai-compatible";

interface CallParams {
  system: string;
  messages: Message[];
  tools?: ToolSchema[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  max_tokens?: number;
  timeout_ms?: number;
}

/**
 * Reads the org's chosen provider + its encrypted key. Any failure here
 * (no override set, key missing/undecryptable, encryption key not
 * configured) silently falls back to Aval's own key — a broken override
 * should never take an org's assistant down, and env-level Anthropic
 * calls already behave identically to how this app worked before model
 * routing existed.
 */
async function resolveOverride(env: AskAvalEnv, orgId: string): Promise<{ providerId: string; apiKey: string } | null> {
  const encryptionKey = (env as unknown as Record<string, string | undefined>).INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return null;

  const db = getDb();
  const [org] = await db.select({ activeModelProvider: organizations.activeModelProvider }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org?.activeModelProvider) return null;

  const [connection] = await db.select({ accessTokenCiphertext: integrationConnections.accessTokenCiphertext, status: integrationConnections.status })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, org.activeModelProvider)))
    .limit(1);
  if (!connection?.accessTokenCiphertext || connection.status !== "connected") return null;

  try {
    const credentials = JSON.parse(await decryptSecret(connection.accessTokenCiphertext, encryptionKey)) as { apiKey?: string };
    if (!credentials.apiKey) return null;
    return { providerId: org.activeModelProvider, apiKey: credentials.apiKey };
  } catch (err) {
    console.error("model_router_decrypt_failed", org.activeModelProvider, err);
    return null;
  }
}

export async function callModel(env: AskAvalEnv, orgId: string, params: CallParams): Promise<MessagesResponse> {
  const override = await resolveOverride(env, orgId);
  if (!override) return callClaude(env, params);

  if (override.providerId === "anthropic") {
    return callClaude({ ...env, ANTHROPIC_API_KEY: override.apiKey, ANTHROPIC_MODEL: getProvider("anthropic")?.defaultModel }, params);
  }

  const catalogEntry = getProvider(override.providerId);
  if (!catalogEntry?.baseUrl || !catalogEntry.defaultModel) return callClaude(env, params);
  return callOpenAiCompatible({ baseUrl: catalogEntry.baseUrl, apiKey: override.apiKey, model: catalogEntry.defaultModel, providerLabel: catalogEntry.title }, params);
}
