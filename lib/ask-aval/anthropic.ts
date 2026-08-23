/**
 * Minimal Anthropic Messages API client for Cloudflare Workers.
 * No SDK — one fetch, typed, with a hard timeout.
 *
 * The key is read from env only. It must never be passed to, logged by,
 * or returned from anything that reaches the client.
 */

export interface AskAvalEnv {
  DB: D1Database;
  /** Secret. Set via this hosting platform's own secret mechanism for a real deployment, or a gitignored .dev.vars file for local dev. */
  ANTHROPIC_API_KEY: string | undefined;
  ANTHROPIC_MODEL?: string;
  AI_DAILY_CALL_CAP?: string;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
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
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AnthropicError";
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
    temperature?: number;
  },
): Promise<MessagesResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AnthropicError("ANTHROPIC_API_KEY is not configured", 500, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
        max_tokens: params.max_tokens ?? 2048,
        temperature: params.temperature ?? 0,
        system: params.system,
        messages: params.messages,
        ...(params.tools ? { tools: params.tools } : {}),
        ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // Never echo the body to the client — it can contain request context.
      console.error("anthropic_error", res.status, body.slice(0, 500));
      throw new AnthropicError(
        `Anthropic request failed (${res.status})`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }

    return (await res.json()) as MessagesResponse;
  } catch (err) {
    if (err instanceof AnthropicError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AnthropicError("Model call timed out", 504, true);
    }
    throw new AnthropicError("Model call failed", 502, true);
  } finally {
    clearTimeout(timer);
  }
}
