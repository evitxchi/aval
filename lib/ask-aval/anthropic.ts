/**
 * Anthropic Messages API client for Cloudflare Workers.
 *
 * Backed by the official @anthropic-ai/sdk (its README lists Cloudflare
 * Workers and Vercel Edge Runtime as supported) rather than a hand-rolled
 * fetch call — swapped in after a GitHub-sourcing audit (docs/DECISIONS.md)
 * found no case for an agent framework here, but a clear one for the
 * transport layer: real retries (408/409/429/5xx), typed errors, and
 * per-request timeouts instead of a bespoke AbortController.
 *
 * Deliberately kept this file's *public* shape (callClaude, AnthropicError,
 * Message, ContentBlock, ToolSchema, MessagesResponse) identical to the
 * hand-rolled version it replaces — loop.ts's control flow and
 * faithfulness.ts's post-hoc citation check depend on none of the SDK's
 * types, so they, and every other caller, needed zero changes.
 *
 * The key is read from env only, passed explicitly to the SDK client
 * rather than relying on its `process.env` fallback — that global isn't
 * reliably present in a Worker. It must never be passed to, logged by, or
 * returned from anything that reaches the client.
 */

import AnthropicSDK, { APIError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

export interface AskAvalEnv {
  DB: D1Database;
  /** Secret. Set via this hosting platform's own secret mechanism for a real deployment, or a gitignored .dev.vars file for local dev. */
  ANTHROPIC_API_KEY: string | undefined;
  ANTHROPIC_MODEL?: string;
  AI_DAILY_CALL_CAP?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 25_000;

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MessagesResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function callClaude(
  env: AskAvalEnv,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolSchema[];
    tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
    max_tokens?: number;
    timeout_ms?: number;
  },
): Promise<MessagesResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AnthropicError("ANTHROPIC_API_KEY is not configured", 500, false);
  }

  const client = new AnthropicSDK({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: params.timeout_ms ?? TIMEOUT_MS,
    maxRetries: 2,
  });

  const request: MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    max_tokens: params.max_tokens ?? 2048,
    system: params.system,
    messages: params.messages as MessageCreateParamsNonStreaming["messages"],
    ...(params.tools ? { tools: params.tools as MessageCreateParamsNonStreaming["tools"] } : {}),
    ...(params.tool_choice ? { tool_choice: params.tool_choice as MessageCreateParamsNonStreaming["tool_choice"] } : {}),
  };

  try {
    const response = await client.messages.create(request);
    return {
      id: response.id,
      content: response.content as unknown as ContentBlock[],
      stop_reason: (response.stop_reason ?? "end_turn") as MessagesResponse["stop_reason"],
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    };
  } catch (err) {
    if (err instanceof APIConnectionTimeoutError) {
      throw new AnthropicError("Model call timed out", 504, true);
    }
    if (err instanceof APIError) {
      // Never echo the response body to the client — it can contain request context.
      console.error("anthropic_error", err.status, JSON.stringify(err.error ?? {}).slice(0, 500));
      const status = err.status ?? 502;
      throw new AnthropicError(`Anthropic request failed (${status})`, status, status === 429 || status >= 500);
    }
    throw new AnthropicError("Model call failed", 502, true);
  }
}
