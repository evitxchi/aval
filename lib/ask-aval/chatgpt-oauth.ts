/**
 * Calls OpenAI's Responses API through the Codex backend using a ChatGPT
 * Plus/Pro subscription's OAuth access token (see
 * lib/integrations/subscription-oauth.ts for what that means and why).
 * This is a genuinely different wire format from every other model
 * provider in this app: openai-compatible.ts's providers (including
 * plain OpenAI-by-API-key) all speak the older, simpler
 * `/chat/completions` shape, but the Codex backend only accepts the
 * newer Responses API shape (`input`/`output` arrays, flat tool
 * definitions, no `max_output_tokens`, response persistence disabled by
 * default) — so this gets its own translator to/from Aval's
 * Anthropic-shaped Message/ContentBlock/ToolSchema types rather than
 * reusing that file.
 */

import { AnthropicError, type ContentBlock, type Message, type MessagesResponse, type ToolResultBlock, type ToolSchema, type ToolUseBlock } from "./anthropic";
import { CHATGPT_CODEX_BASE_URL, CHATGPT_CODEX_HEADERS } from "@/lib/integrations/subscription-oauth";

const TIMEOUT_MS = 25_000;
const DEFAULT_MODEL = "gpt-5.1-codex";

type ResponsesInputItem =
  | { role: "user" | "assistant"; content: { type: "input_text" | "output_text"; text: string }[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

function toResponsesInput(messages: Message[]): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: [{ type: message.role === "user" ? "input_text" : "output_text", text: message.content }] });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content.filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text").map((block) => block.text).join("");
      if (text) out.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const use of message.content.filter((block): block is ToolUseBlock => block.type === "tool_use")) {
        out.push({ type: "function_call", call_id: use.id, name: use.name, arguments: JSON.stringify(use.input) });
      }
      continue;
    }
    // user role: the loop only ever sends tool_result blocks back as the user turn.
    for (const result of message.content.filter((block): block is ToolResultBlock => block.type === "tool_result")) {
      out.push({ type: "function_call_output", call_id: result.tool_use_id, output: result.content });
    }
  }
  return out;
}

function toResponsesTools(tools: ToolSchema[]) {
  return tools.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.input_schema }));
}

function toResponsesToolChoice(choice: { type: "auto" | "any" | "tool"; name?: string } | undefined) {
  if (!choice || choice.type === "auto") return "auto";
  if (choice.type === "tool" && choice.name) return { type: "function" as const, name: choice.name };
  return "required";
}

type ResponsesOutputItem =
  | { type: "message"; role: "assistant"; content: { type: string; text?: string }[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string };

export async function callChatgptOAuth(
  accessToken: string,
  accountId: string | undefined,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolSchema[];
    tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
    timeout_ms?: number;
    model?: string;
    /** Only the flagship GPT-5.6 models accept this; omitted when unset so the model applies its own default. */
    reasoningEffort?: string;
  },
): Promise<MessagesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeout_ms ?? TIMEOUT_MS);
  try {
    const response = await fetch(`${CHATGPT_CODEX_BASE_URL}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...CHATGPT_CODEX_HEADERS,
        ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
      },
      // No max_output_tokens: the Codex backend's /responses endpoint
      // rejects it outright with a 400, unlike the public Responses API.
      // store:false + reasoning.encrypted_content lets a later turn
      // reference an earlier reasoning item without server-side storage
      // (OpenAI's own documented fix for zero-data-retention accounts).
      body: JSON.stringify({
        model: params.model ?? DEFAULT_MODEL,
        instructions: params.system,
        input: toResponsesInput(params.messages),
        store: false,
        include: ["reasoning.encrypted_content"],
        // Only sent when the workspace actually chose a level — omitting the
        // field entirely lets the model apply its own default, which is not
        // the same as pinning it to "medium".
        ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
        ...(params.tools ? { tools: toResponsesTools(params.tools) } : {}),
        ...(params.tool_choice ? { tool_choice: toResponsesToolChoice(params.tool_choice) } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      console.error("chatgpt_oauth_error", response.status, body?.error?.message?.slice(0, 500));
      throw new AnthropicError(`ChatGPT subscription request failed (${response.status})`, response.status, response.status === 429 || response.status >= 500);
    }

    const payload = await response.json() as {
      id?: string;
      output: ResponsesOutputItem[];
      status?: string;
      incomplete_details?: { reason?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content: ContentBlock[] = [];
    for (const item of payload.output) {
      if (item.type === "message") {
        const text = item.content.filter((part) => part.type === "output_text" && typeof part.text === "string").map((part) => part.text).join("");
        if (text) content.push({ type: "text", text });
      } else if (item.type === "function_call") {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(item.arguments || "{}"); } catch { /* leave empty — the loop's next round gets an unusable tool_result and can recover */ }
        content.push({ type: "tool_use", id: item.call_id, name: item.name, input });
      }
    }

    const hasToolCall = payload.output.some((item) => item.type === "function_call");
    const stopReason: MessagesResponse["stop_reason"] = hasToolCall
      ? "tool_use"
      : payload.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : "end_turn";

    return {
      id: payload.id ?? crypto.randomUUID(),
      content,
      stop_reason: stopReason,
      usage: { input_tokens: payload.usage?.input_tokens ?? 0, output_tokens: payload.usage?.output_tokens ?? 0 },
    };
  } catch (err) {
    if (err instanceof AnthropicError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw new AnthropicError("Model call timed out", 504, true);
    throw new AnthropicError("ChatGPT subscription request failed", 502, true);
  } finally {
    clearTimeout(timeout);
  }
}
