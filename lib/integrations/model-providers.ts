import { MODEL_PROVIDER_IDS, getProvider, type ProviderId } from "./catalog";

/**
 * Validates a pasted model-provider API key by making the cheapest possible
 * real call against that provider — never a chat completion (costs money
 * and, for a wrong key, would just fail anyway). Anthropic and every
 * OpenAI-compatible provider in the catalog (everything but Anthropic
 * itself) all expose a `GET /models` listing that requires a valid key,
 * which is enough to prove the key works without spending tokens.
 */
export async function verifyModelProviderKey(provider: string, apiKey: string): Promise<{ accountId: string; accountName: string; metadata: Record<string, unknown> }> {
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) throw new Error(await describeError(response));
    const payload = await response.json() as { data?: { id: string }[] };
    return { accountId: "anthropic", accountName: "Anthropic account", metadata: { modelCount: payload.data?.length ?? 0 } };
  }

  const catalogEntry = getProvider(provider);
  if (!catalogEntry?.baseUrl) throw new Error("No verification method is configured for this model provider yet.");
  const response = await fetch(`${catalogEntry.baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(await describeError(response));
  const payload = await response.json().catch(() => ({})) as { data?: unknown[] };
  return { accountId: provider, accountName: `${catalogEntry.title} account`, metadata: { modelCount: Array.isArray(payload.data) ? payload.data.length : undefined } };
}

async function describeError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } | string; message?: string } | null;
  const detail = typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message;
  return detail ?? `Provider returned ${response.status}. Double-check the key and try again.`;
}

export function isModelProviderId(id: string): id is ProviderId {
  return MODEL_PROVIDER_IDS.has(id as ProviderId);
}

/**
 * A short, hand-picked list for the two subscription providers (Claude,
 * ChatGPT) — neither exposes the kind of open `GET /models` listing the
 * API-key providers below do (Claude's OAuth-scoped Messages API doesn't
 * enumerate models the way a full API key does; the ChatGPT Codex backend
 * only ever serves a small, Codex-specific model set, not OpenAI's full
 * catalog). Kept intentionally short and real rather than a fabricated
 * long list.
 */
const SUBSCRIPTION_MODELS: Record<string, string[]> = {
  claude: ["claude-sonnet-5", "claude-opus-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"],
  chatgpt: ["gpt-5.1-codex", "gpt-5.1-codex-mini"],
};

/**
 * The real, live list of model ids a provider currently offers — used by
 * Settings → Intelligence's "Model being used" picker so the model list
 * reflects what the connected account can actually call, not a hand-typed
 * guess frozen at whenever this catalog entry was written. Every
 * OpenAI-compatible provider shares one `GET {baseUrl}/models` call, since
 * they all return the same `{ data: [{ id }] }` shape; Anthropic uses its
 * own equivalent endpoint; the two subscription providers fall back to the
 * short hand list above.
 */
export async function listModels(provider: string, apiKey: string): Promise<string[]> {
  if (provider === "claude" || provider === "chatgpt") return SUBSCRIPTION_MODELS[provider] ?? [];

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) throw new Error(await describeError(response));
    const payload = await response.json() as { data?: { id: string }[] };
    return (payload.data ?? []).map((model) => model.id);
  }

  const catalogEntry = getProvider(provider);
  if (!catalogEntry?.baseUrl) throw new Error("No model list is available for this provider yet.");
  const response = await fetch(`${catalogEntry.baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(await describeError(response));
  const payload = await response.json().catch(() => ({})) as { data?: { id?: string }[] };
  return (payload.data ?? []).map((model) => model.id).filter((id): id is string => typeof id === "string");
}
