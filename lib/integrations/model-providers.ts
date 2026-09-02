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
