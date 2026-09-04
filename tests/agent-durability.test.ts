import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { LEASE_MS } from "../lib/agents/task-state.ts";

/**
 * The durability guarantees, run against real SQLite using the project's own
 * generated migrations.
 *
 * These properties cannot be asserted by reading TypeScript — "two workers
 * cannot execute the same task" and "the same operation cannot run twice" are
 * claims about what the *database* does under concurrent writes. D1 is SQLite,
 * so exercising the same DDL locally is a faithful test of the constraint,
 * even though it is not a test of D1's networking.
 *
 * Deliberately raw SQL: drizzle's D1 driver cannot run here, and hand-writing
 * the statements is what lets this file test the schema rather than the ORM.
 */

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(`drizzle/${file}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  // agent_tasks references organizations, so the FK needs a parent row.
  db.prepare("INSERT INTO organizations (id, name, owner_user_id, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("org_1", "Test Org", "user_1", NOW, NOW);
  return db;
}

const NOW = 1_800_000_000_000;

function seedTask(db: DatabaseSync, over: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: "task_1", organization_id: "org_1", user_id: "user_1", agent_id: "financial",
    goal: "Analyze liquidity", status: "QUEUED", transcript_json: "[]", step_count: 0,
    max_steps: 12, tokens_used: 0, max_tokens: 60000, parent_task_id: null,
    delegation_depth: 0, cancel_requested: 0, lease_owner: null, lease_expires_at: null,
    result_json: null, error: null, created_at: NOW, updated_at: NOW, finished_at: null,
    ...over,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO agent_tasks (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...columns.map((key) => row[key as keyof typeof row] as never));
  return row;
}

/** The exact claim predicate from lib/agents/tasks.ts `claimTask`. */
function claim(db: DatabaseSync, taskId: string, workerId: string, from: string, now: number): number {
  const result = db.prepare(
    `UPDATE agent_tasks SET status = 'RUNNING', lease_owner = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
  ).run(workerId, now + LEASE_MS, now, taskId, from, now);
  return Number(result.changes);
}

test("only one of two workers racing for the same task wins", () => {
  const db = migratedDatabase();
  seedTask(db);
  // Both read "unclaimed" and both attempt the claim. The predicate, not the
  // read, is what decides: the second update matches zero rows because the
  // first already moved the status and stamped its lease.
  assert.equal(claim(db, "task_1", "worker_a", "QUEUED", NOW), 1);
  assert.equal(claim(db, "task_1", "worker_b", "QUEUED", NOW), 0);
  const [owner] = db.prepare("SELECT lease_owner FROM agent_tasks WHERE id = 'task_1'").all() as { lease_owner: string }[];
  assert.equal(owner.lease_owner, "worker_a");
  db.close();
});

test("a crashed worker's task is reclaimed once its lease expires, not before", () => {
  const db = migratedDatabase();
  seedTask(db);
  claim(db, "task_1", "worker_a", "QUEUED", NOW);

  // worker_a dies here. While the lease stands, nobody else may touch it.
  assert.equal(claim(db, "task_1", "worker_b", "RUNNING", NOW + LEASE_MS - 1), 0);
  // Once it expires, the next worker picks the task up mid-run. Crash
  // recovery is the lock design, not a separate mechanism.
  assert.equal(claim(db, "task_1", "worker_b", "RUNNING", NOW + LEASE_MS + 1), 1);
  db.close();
});

test("a worker cannot re-claim a task it already holds", () => {
  const db = migratedDatabase();
  seedTask(db);
  assert.equal(claim(db, "task_1", "worker_a", "QUEUED", NOW), 1);
  // The predicate that keeps two workers apart also keeps one worker from
  // taking its own lease twice — its lease is still in the future, so the
  // second claim matches nothing. Code that claims after already holding the
  // lease silently does nothing and bails out; lib/agents/runtime.ts guards
  // against exactly that on the approval-resume path.
  assert.equal(claim(db, "task_1", "worker_a", "RUNNING", NOW + 1), 0);
  db.close();
});

test("a resumed worker continues from the persisted transcript rather than restarting", () => {
  const db = migratedDatabase();
  seedTask(db);
  claim(db, "task_1", "worker_a", "QUEUED", NOW);
  const transcript = JSON.stringify([{ role: "user", content: "Goal: Analyze liquidity" }, { role: "assistant", content: "step 1" }]);
  db.prepare("UPDATE agent_tasks SET transcript_json = ?, step_count = 4 WHERE id = 'task_1' AND lease_owner = 'worker_a'").run(transcript);

  assert.equal(claim(db, "task_1", "worker_b", "RUNNING", NOW + LEASE_MS + 1), 1);
  const [task] = db.prepare("SELECT transcript_json, step_count FROM agent_tasks WHERE id = 'task_1'").all() as { transcript_json: string; step_count: number }[];
  assert.equal(task.step_count, 4);
  assert.equal(JSON.parse(task.transcript_json).length, 2);
  db.close();
});

test("a worker that lost its lease cannot write its result over the new owner's work", () => {
  const db = migratedDatabase();
  seedTask(db);
  claim(db, "task_1", "worker_a", "QUEUED", NOW);
  claim(db, "task_1", "worker_b", "RUNNING", NOW + LEASE_MS + 1);

  // worker_a finishes late. Every update is guarded by lease ownership.
  const stale = db.prepare("UPDATE agent_tasks SET status = 'COMPLETED', result_json = '\"stale\"' WHERE id = 'task_1' AND lease_owner = 'worker_a'").run();
  assert.equal(Number(stale.changes), 0);
  const [task] = db.prepare("SELECT status, result_json FROM agent_tasks WHERE id = 'task_1'").all() as { status: string; result_json: string | null }[];
  assert.equal(task.status, "RUNNING");
  assert.equal(task.result_json, null);
  db.close();
});

/* ── duplicate prevention ────────────────────────────────────────────────── */

function insertStep(db: DatabaseSync, over: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: crypto.randomUUID(), task_id: "task_1", organization_id: "org_1", sequence: 1, step_index: 4,
    kind: "tool_call", tool_name: "issue_payment", policy_effect: "allow", deny_code: null,
    risk_level: "critical", args_digest: "d", result_digest: "d", attempt: 1, duration_ms: 10,
    idempotency_key: null, error: null, created_at: NOW, ...over,
  };
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO agent_task_steps (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...columns.map((key) => row[key as keyof typeof row] as never));
}

test("the same financial operation cannot execute twice, even from a retried worker", () => {
  const db = migratedDatabase();
  seedTask(db);
  const key = "issue_payment:task_1:step_4";
  insertStep(db, { sequence: 1, idempotency_key: key });

  // A worker that timed out after the payment succeeded retries the step. It
  // recomputes the identical key from (task, step, tool) and the database
  // refuses the second row, so the second execution never happens.
  assert.throws(() => insertStep(db, { sequence: 2, idempotency_key: key }), /UNIQUE|constraint/i);
  const [{ n }] = db.prepare("SELECT COUNT(*) AS n FROM agent_task_steps WHERE idempotency_key = ?").all(key) as { n: number }[];
  assert.equal(n, 1);
  db.close();
});

test("a reservation blocks the retry even when the first run recorded no result", () => {
  const db = migratedDatabase();
  seedTask(db);
  const key = "issue_payment:task_1:step_4";

  // The worker claims the key, then dies before it can record what happened —
  // the crash that a check-then-write scheme gets wrong, because it leaves no
  // evidence and the retry reads "not used".
  insertStep(db, { sequence: 1, kind: "mutation_reserved", idempotency_key: key, result_digest: null, duration_ms: null });

  // The retry recomputes the same key and cannot claim it. The operation is
  // not repeated, which is the right answer when the system cannot tell
  // whether money already moved.
  assert.throws(() => insertStep(db, { sequence: 2, kind: "mutation_reserved", idempotency_key: key }), /UNIQUE|constraint/i);
  const [{ n }] = db.prepare("SELECT COUNT(*) AS n FROM agent_task_steps WHERE idempotency_key = ?").all(key) as { n: number }[];
  assert.equal(n, 1);
  db.close();
});

test("different steps of the same task are independently executable", () => {
  const db = migratedDatabase();
  seedTask(db);
  insertStep(db, { sequence: 1, step_index: 4, idempotency_key: "issue_payment:task_1:step_4" });
  insertStep(db, { sequence: 2, step_index: 5, idempotency_key: "issue_payment:task_1:step_5" });
  const [{ n }] = db.prepare("SELECT COUNT(*) AS n FROM agent_task_steps").all() as { n: number }[];
  assert.equal(n, 2);
  db.close();
});

test("read-only steps are unconstrained by the idempotency index", () => {
  const db = migratedDatabase();
  seedTask(db);
  // SQLite treats NULLs as distinct in a unique index, so many read steps
  // coexist while any two mutating steps sharing a key collide.
  for (let i = 1; i <= 5; i++) insertStep(db, { sequence: i, tool_name: "get_portfolio_metrics", risk_level: "low", idempotency_key: null });
  const [{ n }] = db.prepare("SELECT COUNT(*) AS n FROM agent_task_steps").all() as { n: number }[];
  assert.equal(n, 5);
  db.close();
});

test("one reasoning step holds many trace rows, and the trace has one definite order", () => {
  const db = migratedDatabase();
  seedTask(db);
  // A step is a model call plus every tool call it proposed. Constraining
  // (task, step_index) to be unique would have silently dropped all but one.
  insertStep(db, { sequence: 1, step_index: 4, kind: "model_call", tool_name: null });
  insertStep(db, { sequence: 2, step_index: 4, kind: "tool_call", tool_name: "get_portfolio_metrics" });
  insertStep(db, { sequence: 3, step_index: 4, kind: "tool_call", tool_name: "get_delinquent_accounts" });
  const rows = db.prepare("SELECT sequence FROM agent_task_steps WHERE step_index = 4 ORDER BY sequence").all() as { sequence: number }[];
  assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3]);
  assert.throws(() => insertStep(db, { sequence: 3, step_index: 9 }), /UNIQUE|constraint/i);
  db.close();
});

/* ── approvals ───────────────────────────────────────────────────────────── */

function insertApproval(db: DatabaseSync, over: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: crypto.randomUUID(), task_id: "task_1", organization_id: "org_1", step_index: 4,
    tool_name: "issue_payment", risk_level: "critical", tier: "elevated_approver",
    amount_cents: 1_245_000, currency: "USD", evidence_json: "{}", status: "pending",
    requested_at: NOW, expires_at: NOW + 86_400_000, decided_at: null, decided_by_user_id: null,
    decision_note: null, ...over,
  };
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO agent_approvals (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...columns.map((key) => row[key as keyof typeof row] as never));
}

test("a step cannot open two approval requests, so a crash mid-park creates no duplicate", () => {
  const db = migratedDatabase();
  seedTask(db);
  insertApproval(db);
  assert.throws(() => insertApproval(db), /UNIQUE|constraint/i);
  db.close();
});

test("two people deciding at once produce one decision, not two", () => {
  const db = migratedDatabase();
  seedTask(db);
  insertApproval(db, { id: "approval_1" });
  const decide = (decision: string, userId: string) =>
    Number(db.prepare("UPDATE agent_approvals SET status = ?, decided_at = ?, decided_by_user_id = ? WHERE id = 'approval_1' AND status = 'pending'")
      .run(decision, NOW + 1000, userId).changes);

  assert.equal(decide("approved", "user_2"), 1);
  // The `status = 'pending'` clause makes the second decision a zero-row write
  // rather than an overwrite, so a rejection can never end up reading as an
  // approval because it landed second.
  assert.equal(decide("rejected", "user_3"), 0);
  const [row] = db.prepare("SELECT status, decided_by_user_id FROM agent_approvals WHERE id = 'approval_1'").all() as { status: string; decided_by_user_id: string }[];
  assert.equal(row.status, "approved");
  assert.equal(row.decided_by_user_id, "user_2");
  db.close();
});
