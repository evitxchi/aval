/** In-memory D1 stand-in plus the fixtures the runtime tests share. */

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";

export const ENV = { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "claude-opus-5" };

/**
 * Builds the schema from the project's own generated migrations and points the
 * runtime at it. D1 is SQLite, so constraint and concurrency behaviour is
 * faithful; the networking is not exercised.
 */
export async function bootRuntime() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  globalThis.__CF_ENV__ = { DB: {} };
  // Mirrors D1's contract: `run` reports meta.changes, reads return positional
  // rows. Getting this wrong would make every lease claim silently fail, which
  // is precisely the class of thing these tests exist to catch.
  globalThis.__DB__ = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") return { rows: [], meta: { changes: Number(statement.run(...params).changes) } };
    statement.setReadBigInts(false);
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  }, { schema: await import("../../db/schema.ts") });

  const now = Date.now();
  for (const [id, name, owner] of [["org_1", "Test Org", "user_1"], ["org_public_demo", "Demo", "guest"]]) {
    sqlite.prepare("INSERT INTO organizations (id, name, owner_user_id, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(id, name, owner, now, now);
  }
  return sqlite;
}

/* ── canned model responses ──────────────────────────────────────────────── */

export function reply(content, stopReason = "tool_use") {
  return {
    content, stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
    routing: { providerId: "anthropic", model: "claude-opus-5" },
  };
}

/** A conclusion with no numeric claims, so the faithfulness gate passes it. */
export function conclude(headline, narrative = "No figures are asserted here.") {
  return reply([{ type: "tool_use", id: "tu_final", name: "render_answer", input: { headline, narrative, confidence: "high" } }]);
}

export function useTool(name, input = {}, id = "tu_tool") {
  return reply([{ type: "tool_use", id, name, input }]);
}

/** Scripts the model: each call consumes the next entry, the last one repeats. */
export function scriptModel(...turns) {
  let index = 0;
  globalThis.__MODEL__ = async () => turns[Math.min(index++, turns.length - 1)];
}
