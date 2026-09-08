import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";
import { encryptSecret, decryptSecret } from "../../lib/integrations/crypto.ts";

const KEY = "test-only-import-encryption-secret";
const ACCOUNT = { Id: "7", Name: "Rental income", AccountType: "Income", AcctNum: "4000" };
const BANK = { Id: "9", Name: "Bank", AccountType: "Bank", AcctNum: "1000" };
const ENTRY = { Id: "154", TxnDate: "2026-09-01", Line: [
  { Id: "0", Amount: 100, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "7" } } },
  { Id: "1", Amount: 100, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "9" } } },
] };
async function setup() {
  const sqlite = await bootRuntime();
  const access = await encryptSecret("old-access", KEY), refresh = await encryptSecret("old-refresh", KEY);
  sqlite.prepare("INSERT INTO integration_connections (id,organization_id,provider,category,status,auth_mode,external_account_id,access_token_ciphertext,refresh_token_ciphertext,expires_at,metadata_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("conn_1", "org_1", "quickbooks", "Accounting", "connected", "oauth2", "123", access, refresh, Date.now() + 3600000, JSON.stringify({ quickbooksEnvironment: "sandbox" }), "user_1", Date.now(), Date.now());
  const worker = await import("../../lib/integrations/sync-worker.ts");
  const env = { INTEGRATION_TOKEN_ENCRYPTION_KEY: KEY, QUICKBOOKS_CLIENT_ID: "client", QUICKBOOKS_CLIENT_SECRET: "secret" };
  const state = () => sqlite.prepare("SELECT * FROM integration_sync_state WHERE connection_id='conn_1'").get();
  const run = () => sqlite.prepare("SELECT * FROM sync_runs ORDER BY rowid DESC LIMIT 1").get();
  const due = () => sqlite.exec("UPDATE integration_sync_state SET next_run_at=0");
  await worker.scheduleImport("org_1", "quickbooks");
  return { sqlite, worker, env, state, run, due };
}
function upstream(url, entries = [ENTRY]) {
  const u = new URL(url);
  assert.equal(u.hostname, "sandbox-quickbooks.api.intuit.com");
  if (u.pathname.endsWith("/preferences")) return Response.json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: "USD" } } } });
  if (u.pathname.endsWith("/cdc")) return Response.json({ CDCResponse: [{ QueryResponse: [{ JournalEntry: entries }] }] });
  const query = u.searchParams.get("query");
  if (query?.includes("FROM Account")) return Response.json({ QueryResponse: { Account: [ACCOUNT, BANK] } });
  assert.ok(query?.includes("FROM JournalEntry"));
  return Response.json({ QueryResponse: { JournalEntry: entries } });
}
test("automatic import progresses across pages, retains provenance, and deduplicates replay", async (t) => {
  const { sqlite, worker, env, state, run, due } = await setup();
  t.mock.method(globalThis, "fetch", async (url) => upstream(url));
  await worker.runImportWorker(env);
  assert.equal(run().status, "page_completed");
  assert.equal(JSON.parse(state().cursor_json).phase, "journals");
  assert.equal(sqlite.prepare("SELECT last_sync_at FROM integration_connections").get().last_sync_at, null);
  await worker.runImportWorker(env);
  assert.equal(run().status, "completed");
  assert.ok(JSON.parse(state().cursor_json).changedSince);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM gl_transactions").get().n, 2);
  assert.deepEqual({ ...sqlite.prepare("SELECT amount_cents,source_provider,source_connection_id FROM gl_transactions WHERE external_id='154:0'").get() }, { amount_cents: 10000, source_provider: "quickbooks", source_connection_id: "conn_1" });
  assert.ok(sqlite.prepare("SELECT last_sync_at FROM integration_connections").get().last_sync_at);
  due(); await worker.runImportWorker(env); await worker.runImportWorker(env);
  assert.equal(run().status, "completed");
  assert.equal(JSON.parse(run().counts_json).unchanged.glTransactions, 2);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM gl_transactions").get().n, 2);
});
test("a full account page resumes at the next offset without marking the import complete", async (t) => {
  const { worker, env, state, run } = await setup();
  const positions = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const query = new URL(url).searchParams.get("query");
    if (!query?.includes("FROM Account")) return upstream(url);
    positions.push(query.match(/STARTPOSITION (\d+)/)[1]);
    return Response.json({ QueryResponse: { Account: positions.length === 1 ? Array.from({ length: 25 }, (_, i) => ({ ...ACCOUNT, Id: String(i + 1), AcctNum: String(i + 1) })) : [] } });
  });
  await worker.runImportWorker(env);
  assert.equal(JSON.parse(state().cursor_json).position, 26);
  await worker.runImportWorker(env);
  assert.deepEqual(positions, ["1", "26"]);
  assert.equal(run().status, "page_completed");
  assert.equal(JSON.parse(state().cursor_json).phase, "journals");
});
test("two workers cannot own one connection or rotate its refresh token concurrently", async (t) => {
  const { worker, env, sqlite } = await setup();
  t.mock.method(globalThis, "fetch", async url => upstream(url));
  const results = await Promise.all([worker.runImportWorker(env), worker.runImportWorker(env)]);
  assert.equal(results.reduce((n, r) => n + r.processed, 0), 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sync_runs").get().n, 1);
});
test("401 refreshes once, persists the rotated refresh token, and retries the failed read", async (t) => {
  const { worker, env, sqlite, run } = await setup();
  let refreshes = 0, first = true;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.includes("tokens/bearer")) {
      refreshes++; assert.equal(new URLSearchParams(init.body).get("refresh_token"), "old-refresh");
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    }
    if (first) { first = false; return new Response("", { status: 401 }); }
    assert.equal(init.headers.authorization, "Bearer new-access");
    return upstream(url);
  });
  await worker.runImportWorker(env);
  assert.equal(refreshes, 1); assert.equal(run().status, "page_completed");
  const saved = sqlite.prepare("SELECT refresh_token_ciphertext FROM integration_connections").get();
  assert.equal(await decryptSecret(saved.refresh_token_ciphertext, KEY), "new-refresh");
});
test("rate limiting schedules bounded retries without advancing the checkpoint", async (t) => {
  const { worker, env, state, run, due } = await setup();
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429, headers: { "retry-after": "60" } }));
  for (let i = 1; i <= 4; i++) {
    due(); await worker.runImportWorker(env);
    assert.equal(state().cursor_json, "{}");
    assert.equal(state().attempts, i);
    assert.equal(state().enabled, i < 4 ? 1 : 0);
  }
  assert.equal(run().status, "needs_review");
});
test("changed and removed journal lines pause instead of silently keeping or duplicating stale money", async (t) => {
  const { worker, env, sqlite, state, run, due } = await setup();
  let entries = [ENTRY];
  t.mock.method(globalThis, "fetch", async url => upstream(url, entries));
  await worker.runImportWorker(env); await worker.runImportWorker(env);
  due(); await worker.runImportWorker(env);
  const checkpoint = state().cursor_json;
  entries = [{ ...ENTRY, Line: [{ ...ENTRY.Line[0], Amount: 150 }] }];
  await worker.runImportWorker(env);
  assert.equal(run().status, "needs_review"); assert.equal(state().cursor_json, checkpoint);
  assert.equal(sqlite.prepare("SELECT amount_cents FROM gl_transactions WHERE external_id='154:0'").get().amount_cents, 10000);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM gl_transactions").get().n, 2);
});
test("deleted journals and stale CDC windows require reconciliation without advancing", async (t) => {
  const { worker, env, state, sqlite, run } = await setup();
  const current = { phase: "cdc", position: 1, changedSince: new Date(Date.now() - 60000).toISOString(), cycleStartedAt: new Date().toISOString() };
  sqlite.prepare("UPDATE integration_sync_state SET cursor_json=?").run(JSON.stringify(current));
  t.mock.method(globalThis, "fetch", async url => upstream(url, [{ Id: "154", status: "Deleted" }]));
  await worker.runImportWorker(env);
  assert.equal(run().status, "needs_review"); assert.deepEqual(JSON.parse(state().cursor_json), current);
  await worker.scheduleImport("org_1", "quickbooks");
  sqlite.prepare("UPDATE integration_sync_state SET cursor_json=?").run(JSON.stringify({ changedSince: "2020-01-01T00:00:00Z" }));
  await worker.runImportWorker(env);
  assert.match(run().error, /change window/);
});
test("foreign currency and malformed source amounts never become USD reporting figures", async (t) => {
  const { worker, env, sqlite, run } = await setup();
  t.mock.method(globalThis, "fetch", async () => Response.json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: "MXN" } } } }));
  await worker.runImportWorker(env);
  assert.match(run().error, /USD books only/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM gl_accounts").get().n, 0);
  await worker.scheduleImport("org_1", "quickbooks");
  globalThis.fetch.mock.mockImplementation(async url => upstream(url, [{ ...ENTRY, Line: [{ ...ENTRY.Line[0], Amount: 1.005 }] }]));
  await worker.runImportWorker(env); await worker.runImportWorker(env);
  assert.equal(run().status, "needs_review");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM gl_transactions").get().n, 0);
});
test("expired leases recover, paused imports stay paused, and another company cannot reuse the old ledger", async (t) => {
  const { worker, env, sqlite, state } = await setup();
  sqlite.exec("UPDATE integration_sync_state SET lease_token='dead-worker',lease_expires_at=0");
  t.mock.method(globalThis, "fetch", async url => upstream(url));
  assert.equal((await worker.runImportWorker(env)).processed, 1);
  await worker.scheduleImport("org_1", "quickbooks", false);
  assert.equal((await worker.runImportWorker(env)).processed, 0); assert.equal(state().enabled, 0);
  sqlite.exec("UPDATE integration_connections SET external_account_id='456'");
  await assert.rejects(worker.scheduleImport("org_1", "quickbooks"), /company changed/);
  await assert.rejects(worker.scheduleImport("org_public_demo", "quickbooks"), /Connect and verify/);
});
