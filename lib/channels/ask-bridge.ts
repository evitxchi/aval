/**
 * The bridge from a channel message to Ask Aval.
 *
 * `handleAskAval` is reused **unchanged**, which is the brief's central
 * constraint and the reason this file is as thin as it is. WhatsApp is a
 * second client of the existing backend, so everything that decides what an
 * answer contains — the tool registry, the persona envelope, the faithfulness
 * gate that withholds an answer rather than shipping an invented figure — is
 * the same code the dashboard runs. If this file grew a query, the guarantee
 * would be gone.
 *
 * Two small pieces of glue and nothing else:
 *
 *  - the handler returns a `Response` whose body is the `render_answer` JSON,
 *    and the renderer needs the parsed object;
 *  - the role has already chosen a tool set, and that choice is expressed to
 *    the handler as a persona, because a persona is what `handleAskAval`
 *    already understands. Inventing a second narrowing mechanism beside it
 *    would be a second gate.
 */

import { handleAskAval } from "@/lib/ask-aval/handler";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";
import { sessionFor, type InboundIdentity } from "./identity-types.ts";
import type { AskAnswer } from "./whatsapp/render.ts";
import type { ChannelLocale } from "./copy.ts";

export interface AskResult {
  answer: AskAnswer;
  toolsUsed: string[];
}

/**
 * Ask a question as a resolved channel identity.
 *
 * Returns null when the handler declined or failed. A null here becomes the
 * "I couldn't answer that from the connected data" reply — never a fabricated
 * figure, and never a raw error string, which would leak internals to a phone.
 */
export async function askAsIdentity(input: {
  question: string;
  identity: InboundIdentity;
  locale: ChannelLocale;
  env: AskAvalEnv;
}): Promise<AskResult | null> {
  const session = sessionFor(input.identity);

  const response = await handleAskAval(
    input.question,
    input.env,
    session,
    input.locale,
    undefined,
    // The persona carries the tool narrowing. A role with the widest access
    // passes `undefined`, which lets the existing auto-router pick a
    // specialist — the same behaviour the dashboard gets.
    personaForIdentity(input.identity),
    // Never a guest. A channel identity is by definition linked, and passing
    // `true` here would hand a linked operator the shared demo workspace's
    // restrictions.
    false,
  );

  if (!response.ok) return null;

  try {
    const parsed = (await response.json()) as AskAnswer & { tools_used?: string[]; error?: string };
    if (parsed.error || typeof parsed.headline !== "string") return null;
    return { answer: parsed, toolsUsed: parsed.tools_used ?? [] };
  } catch {
    // A body that is not the JSON we expect is a contract break upstream, not
    // something to guess at.
    return null;
  }
}

/**
 * Which persona a role runs as.
 *
 * `undefined` means "no explicit persona", which is what the dashboard sends
 * and which lets `routeToPersona` choose. A coordinator is pinned to
 * `realEstate` because that persona's tool set is the operations-side read
 * surface their role allows, and pinning is how the narrowing survives a
 * question whose wording would otherwise route it to the financial specialist.
 */
function personaForIdentity(identity: InboundIdentity): string | undefined {
  switch (identity.role) {
    case "owner":
    case "approver":
      return undefined;
    case "member":
      return "realEstate";
    case "resident":
      // Unreachable: the pipeline hands residents to a human before here.
      // Kept explicit so a future caller that skips that check fails closed
      // rather than inheriting the widest persona by falling off the switch.
      return "realEstate";
  }
}
