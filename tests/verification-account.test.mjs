import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { accountSql, main, VERIFICATION_USER_ID, VERIFICATION_EMAIL } from "../scripts/prepare-smoke-account.mjs";
import { hashPassword, verifyPassword } from "../lib/auth/password.ts";

test("deployment verification provisions only its reserved identity and rotates its password without changing customer records", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,display_name TEXT,created_at INTEGER,updated_at INTEGER); CREATE TABLE organizations (id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,created_at INTEGER,updated_at INTEGER);");
  db.exec("INSERT INTO users VALUES ('customer','owner@example.test','unchanged','Owner',1,1); INSERT INTO organizations VALUES ('customer-org','Customer workspace','customer',1,1);");
  const first = await hashPassword("initial-test-password");
  db.exec(accountSql(first, 1000));
  const second = await hashPassword("rotated-test-password");
  db.exec(accountSql(second, 2000));
  const account = db.prepare("SELECT * FROM users WHERE id=?").get(VERIFICATION_USER_ID);
  assert.equal(account.email, VERIFICATION_EMAIL);
  assert.equal(account.created_at, 1000);
  assert.equal(account.updated_at, 2000);
  assert.ok(await verifyPassword("rotated-test-password", account.password_hash));
  assert.ok(!(await verifyPassword("initial-test-password", account.password_hash)));
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE id='customer'").get().password_hash, "unchanged");
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM organizations").get().n, 2);
});

test("verification preparation refuses to execute outside the deployment runner", async () => {
  const actions = process.env.GITHUB_ACTIONS, temp = process.env.RUNNER_TEMP;
  delete process.env.GITHUB_ACTIONS; delete process.env.RUNNER_TEMP;
  try { await assert.rejects(main(), /inside the deployment workflow/); }
  finally { if (actions) process.env.GITHUB_ACTIONS = actions; if (temp) process.env.RUNNER_TEMP = temp; }
});
