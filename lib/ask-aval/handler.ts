/**
 * POST /api/assistant/ask
 *
 * Request:  { question: string, locale?: "en" | "es-mx" }
 * Response: { headline, narrative, metrics[], chart?, evidence_ids[], action?, actionDetail?, confidence, tools_used[] }
 *
 * Guarantees:
 *  - org scoping comes from the session, never from the model
 *  - the model never sees raw sample data structure, only tool results
 *  - every number in the final narrative/document is verified against tool
 *    output before responding — a violation withholds the answer rather
 *    than shipping an invented figure to a property manager
 *  - bounded: 4 tool rounds, 25s per call, per-org daily cap
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";
import { callClaude, AnthropicError, type AskAvalEnv, type Message, type ContentBlock, type ToolUseBlock } from "./anthropic";
import { TOOLS, runTool } from "./tools";

export interface AskAvalSession {
  orgId: string;
  userId: string;
}

const MAX_ROUNDS = 4;
const MAX_QUESTION_CHARS = 600;

const SYSTEM = `You are Ask Aval, the financial and operations analyst embedded in a property management dashboard called Aval.

You answer questions, draft proposals, and surface analysis about the operator's portfolio using ONLY the tools provided.

Hard rules:
- You cannot compute. Every figure you state must come from a tool result, unchanged (rounding for readability is fine; changing scale or inventing a value is not).
- If a tool did not return a number you need, call another tool. If no tool can supply it, say plainly that the data is not connected and name what would be needed.
- Never estimate, extrapolate, or fill a gap with a plausible value.
- Arithmetic decomposition is causal; anything else is a hypothesis and must be hedged ("consistent with", "likely related to"). Never state an unverified cause as fact.
- This is a sample-mode demo: most tools return one fixed snapshot, not a live per-period feed. Read each tool's own notes about what it can and can't answer, and be upfront with the user about that limitation when it's relevant to their question.
- You have no authority to take action yourself. At most, name one concrete next action the user could approve.

Finish by calling render_answer exactly once. Write no prose outside it.
Tone: plain and specific. No greeting, no sign-off, no exclamation marks.`;

export async function handleAskAval(
  rawQuestion: string,
  env: AskAvalEnv,
  session: AskAvalSession,
  locale: string,
  focusedModule?: { label: string; snapshot: string },
): Promise<Response> {
  const question = rawQuestion.trim();
  if (!question) return json({ error: "A question is required" }, 400);
  if (question.length > MAX_QUESTION_CHARS) return json({ error: "Question is too long" }, 400);

  // ── spend guard ───────────────────────────────────────────────────────
  const db = getDb();
  const cap = Number(env.AI_DAILY_CALL_CAP ?? "400");
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const day = dayStart.toISOString().slice(0, 10);
  const usedToday = await db.select().from(aiUsage).where(and(eq(aiUsage.organizationId, session.orgId), eq(aiUsage.day, day), gte(aiUsage.createdAt, dayStart)));
  if (usedToday.length >= cap) return json({ error: "Ask Aval has reached its usage cap for today. Try again tomorrow." }, 429);

  // ── tool loop ─────────────────────────────────────────────────────────
  const localeInstruction = locale === "es-mx" ? "Respond in Spanish (Mexico)." : "Respond in English.";
  const moduleContext = focusedModule
    ? `\n\n(The user focused this question on a dashboard module titled "${focusedModule.label}". Its visible on-screen text: ${JSON.stringify(focusedModule.snapshot)}. Still use the tools for any figures you cite — the snapshot text is context, not a verified source.)`
    : "";
  const messages: Message[] = [{ role: "user", content: `${question}\n\n(${localeInstruction})${moduleContext}` }];
  const seenNumbers = new Set<number>();
  const toolsUsed: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callClaude(env, {
        system: SYSTEM,
        messages,
        tools: TOOLS,
        // On the last round, force the model to conclude.
        tool_choice: round === MAX_ROUNDS - 1 ? { type: "tool", name: "render_answer" } : { type: "auto" },
        max_tokens: 2048,
        temperature: 0,
      });

      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;

      const toolUses = res.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      const final = toolUses.find((use) => use.name === "render_answer");

      if (final) {
        const answer = final.input;
        const gate = checkFaithfulness(answer, seenNumbers);
        if (!gate.ok) {
          console.error("ask_aval_faithfulness_violation", { orgId: session.orgId, unsupported: gate.unsupported });
          await recordUsage(session, day, inputTokens, outputTokens);
          return json({ error: "The answer referenced figures that aren't in the underlying data, so it was withheld." }, 502);
        }
        await recordUsage(session, day, inputTokens, outputTokens);
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

    await recordUsage(session, day, inputTokens, outputTokens);
    return json({ error: "Could not resolve the question within the tool budget." }, 504);
  } catch (err) {
    await recordUsage(session, day, inputTokens, outputTokens);
    if (err instanceof AnthropicError) {
      return json({ error: err.message, retryable: err.retryable }, err.status >= 500 ? 502 : 400);
    }
    console.error("ask_aval_unhandled", err);
    return json({ error: "The assistant is unavailable right now." }, 500);
  }
}

/* ── faithfulness gate ──────────────────────────────────────────────────── */

/**
 * Every numeral in the narrative, document, and metric/chart values must
 * have appeared in a tool result. Fails closed: a violation withholds the
 * answer rather than shipping an invented figure to a property manager.
 */
export function checkFaithfulness(answer: Record<string, unknown>, seen: Set<number>): { ok: true } | { ok: false; unsupported: number[] } {
  const text = [answer.narrative, answer.headline, answer.document].filter((value) => typeof value === "string").join(" ");
  const claimed: number[] = [];

  const matches = text.match(/-?\d[\d,]*\.?\d*/g) ?? [];
  for (const match of matches) {
    const n = Number(match.replace(/,/g, ""));
    if (Number.isFinite(n)) claimed.push(round2(n));
  }
  for (const metric of asArray(answer.metrics)) {
    const value = (metric as { value?: unknown }).value;
    if (typeof value === "number") claimed.push(round2(value));
  }
  for (const point of asArray((answer.chart as { points?: unknown } | undefined)?.points)) {
    const y = (point as { y?: unknown }).y;
    if (typeof y === "number") claimed.push(round2(y));
  }

  const IGNORE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 30, 60, 90, 100]);
  const unsupported = claimed.filter((n) => !seen.has(n) && !IGNORE.has(n) && !nearMatch(n, seen));
  return unsupported.length === 0 ? { ok: true } : { ok: false, unsupported };
}

/** Tolerate the model rounding 28,512.40 to 28,512 or a nearby restatement. */
function nearMatch(n: number, seen: Set<number>): boolean {
  for (const s of seen) {
    if (s === 0) continue;
    if (Math.abs(s - n) / Math.abs(s) < 0.005) return true;
    if (Math.round(s) === Math.round(n)) return true;
  }
  return false;
}

/* ── helpers ────────────────────────────────────────────────────────────── */

async function recordUsage(session: AskAvalSession, day: string, inputTokens: number, outputTokens: number) {
  try {
    const db = getDb();
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      organizationId: session.orgId,
      userId: session.userId,
      day,
      inputTokens,
      outputTokens,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("ask_aval_usage_write_failed", err);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
