import { MODEL_PROVIDER_IDS, getProvider, type ProviderId } from "./catalog";
import { CHATGPT_CODEX_BASE_URL, CHATGPT_CODEX_HEADERS } from "./subscription-oauth";

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
  // Used only when live discovery fails, and surfaced to the user as
  // unverified when it is (see listModelsDetailed). An empty picker leaves
  // someone unable to pick anything at all; a labelled fallback lets them
  // proceed while still saying the list could not be confirmed.
  //
  // The current flagship family per OpenAI's model docs. `gpt-5.6` is an
  // alias for `gpt-5.6-sol` and is listed separately because a user who
  // knows the alias should be able to find it by name.
  chatgpt: ["gpt-5.6-sol", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
};

/** Pinned in the query string the way the Codex CLI pins it; the backend gates its response on it. */
const CODEX_CLIENT_VERSION = "0.145.0";

/**
 * The model list the Codex backend itself publishes for a connected ChatGPT
 * subscription. Not `api.openai.com/v1/models` — a subscription can't call
 * that at all; this is the same undocumented backend the inference requests
 * go to, so it's the only list that reflects what the plan can actually run.
 *
 * Models marked `visibility: "hide"` are filtered out: they're returned but
 * not offerable, and showing them produces a picker whose entries fail.
 */
async function listChatgptCodexModels(accessToken: string, accountId?: string): Promise<string[]> {
  const response = await fetch(`${CHATGPT_CODEX_BASE_URL}/models?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...CHATGPT_CODEX_HEADERS,
      ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
    },
  });
  if (!response.ok) throw new Error(await describeError(response));
  const payload = await response.json() as { data?: unknown; models?: unknown };
  // The endpoint has shipped both shapes; accept either rather than break on
  // whichever one it is answering with today.
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .filter((row) => row.visibility !== "hide")
    .map((row) => (typeof row.id === "string" ? row.id : typeof row.slug === "string" ? row.slug : ""))
    .filter((id) => id.length > 0);
}

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
/**
 * Live discovery, with a labelled fallback.
 *
 * `verified: false` means the account's own catalog could not be reached and
 * the names came from a static list — the UI says so rather than presenting
 * them as confirmed, because a model this account cannot call will fail at
 * send time and the user deserves to know that is possible before choosing.
 */
export async function listModelsDetailed(provider: string, apiKey: string, accountId?: string): Promise<{ models: string[]; verified: boolean; reason?: string }> {
  if (provider === "chatgpt") {
    try {
      const models = await listChatgptCodexModels(apiKey, accountId);
      if (models.length > 0) return { models, verified: true };
      return { models: SUBSCRIPTION_MODELS.chatgpt, verified: false, reason: "empty_response" };
    } catch (error) {
      return {
        models: SUBSCRIPTION_MODELS.chatgpt,
        verified: false,
        reason: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
  return { models: await listModels(provider, apiKey, accountId), verified: true };
}

export async function listModels(provider: string, apiKey: string, accountId?: string): Promise<string[]> {
  // ChatGPT asks the Codex backend for its real list; Claude's OAuth surface
  // publishes no equivalent endpoint, so it keeps the short static list.
  if (provider === "chatgpt") return listChatgptCodexModels(apiKey, accountId);
  if (provider === "claude") return SUBSCRIPTION_MODELS[provider] ?? [];

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


/**
 * Reasoning effort levels the flagship GPT-5.6 models accept.
 *
 * Deliberately separate from the model list: effort is a per-request
 * parameter, not a model, and folding the two together would produce a picker
 * with two dozen fake "models" that don't exist as ids.
 */
export const REASONING_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

/** Whether a model id accepts a reasoning-effort setting. */
export function supportsReasoningEffort(model: string): boolean {
  return /^gpt-5\.6(-(sol|terra|luna))?$/.test(model.trim());
}

/**
 * Known model ids per provider, for the picker to offer before (or instead of)
 * a live catalog call.
 *
 * A curated list rather than free text: a typo in a model id fails at send
 * time with a provider error that reads like a broken integration, and asking
 * a property manager to "enter an exact model id from this provider's docs"
 * pushes a research task onto them for no benefit. Where a provider publishes
 * a live catalog, discovery still wins — this is the floor, not the ceiling.
 */
export const KNOWN_MODELS: Record<string, string[]> = {
  openai: ["gpt-5.6-sol", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
  chatgpt: ["gpt-5.6-sol", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"],
  claude: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"],
  google_gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.6", "google/gemini-2.5-pro"],
  moonshot: ["kimi-k2-turbo-preview", "moonshot-v1-128k"],
  zai: ["glm-4.6", "glm-4.5-air"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  alibaba_model_studio: ["qwen-max", "qwen-plus", "qwen-turbo"],
  siliconflow: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
};

/** The ids to offer for a provider, preferring a live list when one was fetched. */
export function modelOptionsFor(provider: string, discovered?: string[] | null): string[] {
  if (discovered && discovered.length > 0) return discovered;
  return KNOWN_MODELS[provider] ?? [];
}
