import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { latestApprovalSettledPredicate } from "../lib/agents/task-sql.ts";
import { isSequenceCollision } from "../lib/audit/append-rules.ts";

/**
 * The raw predicates, rendered from the shipped builders and executed against
 * the project's own migrations.
 *
 * A raw `sql` template is where the compiler stops helping: a column
 * interpolated into one renders table-qualified, and a value interpolated into
 * one is handed to the driver unmapped. Both typecheck. Both are runtime
 * failures. Only rendering and running the real thing catches them.
 */

const NOW = new Date(1_800_000_000_000);

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  db.prepare("INSERT INTO organizations (id, name, owner_user_id, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("org_1", "Test Org", "user_1", NOW.getTime(), NOW.getTime());
  return db;
}

function render(now: Date) {
  return new SQLiteSyncDialect().sqlToQuery(latestApprovalSettledPredicate(now));
}

test("no raw predicate parameter is an object the driver cannot bind", () => {
  const { params } = render(NOW);
  for (const param of params) {
    assert.ok(
      param === null || ["string", "number", "bigint", "boolean"].includes(typeof param),
      `a raw sql template bound ${Object.prototype.toString.call(param)}; D1 accepts only primitives`,
    );
  }
  assert.ok(params.includes(NOW.getTime()), "the timestamp must reach the driver as epoch milliseconds");
});

/** Seeds one parked task and one approval against it. */
function seedParked(db: DatabaseSync, taskId: string, approval: { stepIndex: number; status: string; expiresAt: number }) {
  db.prepare(`INSERT INTO agent_tasks (id, organization_id, user_id, agent_id, goal, status, transcript_json,
      step_count, max_steps, tokens_used, max_tokens, delegation_depth, cancel_requested, created_at, updated_at)
      VALUES (?, 'org_1', 'user_1', 'financial', 'goal', 'WAITING_FOR_APPROVAL', '[]', 0, 12, 0, 60000, 0, 0, ?, ?)`)
    .run(taskId, NOW.getTime(), NOW.getTime());
  db.prepare(`INSERT INTO agent_approvals (id, task_id, organization_id, step_index, tool_name, risk_level, tier,
      evidence_json, status, required_approvals, approvals_received, requested_at, expires_at)
      VALUES (?, ?, 'org_1', ?, 'publish_listing', 'high', 'single_approver', '{}', ?, 1, 0, ?, ?)`)
    .run(`ap_${taskId}_${approval.stepIndex}`, taskId, approval.stepIndex, approval.status, NOW.getTime(), approval.expiresAt);
}

function resumable(db: DatabaseSync, now: Date): string[] {
  const { sql: text, params } = render(now);
  return db.prepare(`SELECT id FROM agent_tasks WHERE status = 'WAITING_FOR_APPROVAL' AND ${text} ORDER BY id`)
    .all(...(params as never[])).map((row) => (row as { id: string }).id);
}

test("only a settled or timed-out approval wakes the task it parked", () => {
  const db = migratedDatabase();
  seedParked(db, "task_pending", { stepIndex: 0, status: "pending", expiresAt: NOW.getTime() + 3_600_000 });
  seedParked(db, "task_decided", { stepIndex: 0, status: "approved", expiresAt: NOW.getTime() + 3_600_000 });
  seedParked(db, "task_expired", { stepIndex: 0, status: "pending", expiresAt: NOW.getTime() - 1 });

  assert.deepEqual(resumable(db, NOW), ["task_decided", "task_expired"]);
  db.close();
});

test("an older decided approval cannot wake a task parked on a newer one", () => {
  const db = migratedDatabase();
  seedParked(db, "task_1", { stepIndex: 0, status: "approved", expiresAt: NOW.getTime() + 3_600_000 });
  // The task moved on and parked again; the live request is still undecided.
  db.prepare(`INSERT INTO agent_approvals (id, task_id, organization_id, step_index, tool_name, risk_level, tier,
      evidence_json, status, required_approvals, approvals_received, requested_at, expires_at)
      VALUES ('ap_task_1_3', 'task_1', 'org_1', 3, 'publish_listing', 'high', 'single_approver', '{}', 'pending', 1, 0, ?, ?)`)
    .run(NOW.getTime(), NOW.getTime() + 3_600_000);

  assert.deepEqual(resumable(db, NOW), []);
  db.close();
});

/* ── audit append retry classification ───────────────────────────────────── */

test("a lost sequence race is retried; anything else fails fast", () => {
  assert.equal(isSequenceCollision(new Error("UNIQUE constraint failed: answer_audit_log.sequence")), true);
  assert.equal(isSequenceCollision({ cause: { message: "SQLITE_CONSTRAINT: UNIQUE constraint failed" } }), true);
  assert.equal(isSequenceCollision(new Error("D1_ERROR: no such table")), false);
  assert.equal(isSequenceCollision(new Error("Cloudflare D1 binding `DB` is unavailable.")), false);
  assert.equal(isSequenceCollision(undefined), false);
  assert.equal(isSequenceCollision({ message: 12345 }), false);
});
