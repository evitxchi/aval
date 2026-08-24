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

import type { AskAvalEnv, Message } from "./anthropic";
import type { AskAvalSession } from "./usage";
import { runAskAvalLoop, json } from "./loop";

export type { AskAvalSession } from "./usage";

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

  const localeInstruction = locale === "es-mx" ? "Respond in Spanish (Mexico)." : "Respond in English.";
  const moduleContext = focusedModule
    ? `\n\n(The user focused this question on a dashboard module titled "${focusedModule.label}". Its visible on-screen text: ${JSON.stringify(focusedModule.snapshot)}. Still use the tools for any figures you cite — the snapshot text is context, not a verified source.)`
    : "";
  const messages: Message[] = [{ role: "user", content: `${question}\n\n(${localeInstruction})${moduleContext}` }];

  return runAskAvalLoop(env, session, SYSTEM, messages);
}
