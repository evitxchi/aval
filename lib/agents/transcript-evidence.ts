/**
 * Rebuilds the numeric evidence set from persisted tool-result messages.
 *
 * A durable run may finish in a different Worker invocation from the one that
 * read its data. The in-memory evidence set therefore cannot be authoritative:
 * after a crash or a clean yield it starts empty. The transcript is the durable
 * source of truth, so every invocation derives the same set from it before the
 * faithfulness gate runs.
 *
 * Only JSON number values count. Numeric-looking free text is deliberately
 * ignored, matching the collectors used by the tool executors.
 */

interface TranscriptMessage {
  role?: unknown;
  content?: unknown;
}

interface ToolResultBlock {
  type?: unknown;
  content?: unknown;
  is_error?: unknown;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(round2(value));
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectNumbers(item, out));
  }
}

function parsedToolResult(content: unknown): unknown {
  if (typeof content !== "string") return content;
  try { return JSON.parse(content); } catch { return null; }
}

export function evidenceNumbersFromTranscript(messages: readonly TranscriptMessage[]): Set<number> {
  const seen = new Set<number>();
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const candidate of message.content) {
      const block = candidate as ToolResultBlock;
      if (block.type !== "tool_result" || block.is_error === true) continue;
      collectNumbers(parsedToolResult(block.content), seen);
    }
  }
  return seen;
}
