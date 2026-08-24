/**
 * Shared tool-calling loop behind every Ask Aval endpoint (question answers
 * and document drafts alike). Bounded, faithfulness-gated, and metered —
 * callers only supply a system prompt and the opening message.
 */

import { callClaude, AnthropicError, type AskAvalEnv, type Message, type ContentBlock, type ToolUseBlock, type ToolSchema } from "./anthropic";
import { TOOLS, runTool } from "./tools";
import { isDailyCapExceeded, recordUsage, type AskAvalSession } from "./usage";
import { checkFaithfulness, withDerivedNumbers, round2 } from "./faithfulness";

const MAX_ROUNDS = 4;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function runAskAvalLoop(
  env: AskAvalEnv,
  session: AskAvalSession,
  system: string,
  messages: Message[],
  tools: ToolSchema[] = TOOLS,
  finalToolName = "render_answer",
  maxTokens = 2048,
  timeoutMs?: number,
): Promise<Response> {
  if (await isDailyCapExceeded(env, session)) return json({ error: "Ask Aval has reached its usage cap for today. Try again tomorrow." }, 429);

  const seenNumbers = new Set<number>();
  const toolsUsed: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callClaude(env, {
        system,
        messages,
        tools,
        // On the last round, force the model to conclude.
        tool_choice: round === MAX_ROUNDS - 1 ? { type: "tool", name: finalToolName } : { type: "auto" },
        max_tokens: maxTokens,
        timeout_ms: timeoutMs,
      });

      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;

      const toolUses = res.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      const final = toolUses.find((use) => use.name === finalToolName);

      if (final) {
        const answer = final.input;
        const gate = checkFaithfulness(answer, withDerivedNumbers(seenNumbers));
        if (!gate.ok) {
          console.error("ask_aval_faithfulness_violation", { orgId: session.orgId, unsupported: gate.unsupported });
          await recordUsage(session, inputTokens, outputTokens);
          return json({ error: "The answer referenced figures that aren't in the underlying data, so it was withheld." }, 502);
        }
        await recordUsage(session, inputTokens, outputTokens);
        return json({ ...answer, tools_used: toolsUsed });
      }

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        messages.push({ role: "assistant", content: res.content });
        messages.push({ role: "user", content: "Return the answer by calling render_answer. Do not write prose outside it." });
        continue;
      }

      messages.push({ role: "assistant", content: res.content });

      const results: ContentBlock[] = [];
      for (const use of toolUses) {
        toolsUsed.push(use.name);
        try {
          const out = await runTool(use.name, use.input);
          out.numbers.forEach((n) => seenNumbers.add(round2(n)));
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.json) });
        } catch (err) {
          console.error("ask_aval_tool_error", use.name, err);
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ error: "Tool failed. Do not guess the value." }), is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }

    await recordUsage(session, inputTokens, outputTokens);
    return json({ error: "Could not resolve the question within the tool budget." }, 504);
  } catch (err) {
    await recordUsage(session, inputTokens, outputTokens);
    if (err instanceof AnthropicError) {
      return json({ error: err.message, retryable: err.retryable }, err.status >= 500 ? 502 : 400);
    }
    console.error("ask_aval_unhandled", err);
    return json({ error: "The assistant is unavailable right now." }, 500);
  }
}
