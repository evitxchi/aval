import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { bootRuntime } from "./harness.mjs";
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
async function setup() {
  const sqlite = await bootRuntime();
  const { env } = await import("cloudflare:workers");
  Object.assign(env, { INTEGRATION_TOKEN_ENCRYPTION_KEY: "test-only-secret-longer-than-24-characters", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  return { sqlite, env, validate: await import("../../app/api/integrations/validate/route.ts"), connect: await import("../../app/api/integrations/connect/route.ts"), verify: await import("../../app/api/integrations/verify/route.ts"), callback: await import("../../app/api/oauth/callback/route.ts"), sync: await import("../../app/api/sync/route.ts"), oauth: await import("../../lib/integrations/oauth.ts") };
}
function request(user, path, body) {
  return new Request(`https://aval.test${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` } : {}), "content-type": "application/json",
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function connectKey(connect, credentials = { apiKey: "provider-secret" }) {
  const response = await connect.POST(request("alice", "/api/integrations/connect", { provider: "asana", credentials }));
  assert.equal(response.status, 200);
  return (await response.json()).connection.id;
}
test("verification scopes records by workspace, encrypts keys, and never fabricates a sync timestamp", async (t) => {
  const { sqlite, connect, verify, sync } = await setup();
  const id = await connectKey(connect);
  const before = sqlite.prepare("SELECT * FROM integration_connections WHERE id=?").get(id);
  assert.equal(before.status, "verification_required"); assert.ok(!before.access_token_ciphertext.includes("provider-secret"));
  assert.equal((await verify.POST(request("bob", "/api/integrations/verify", { connectionId: id }))).status, 404);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://app.asana.com/api/1.0/users/me");
    assert.equal(init.redirect, "error"); assert.equal(init.headers.authorization, "Bearer provider-secret");
    return Response.json({ data: { gid: "user-123", name: "Alice" } });
  });
  assert.equal((await verify.POST(request("alice", "/api/integrations/verify", { connectionId: id }))).status, 200);
  const after = sqlite.prepare("SELECT * FROM integration_connections WHERE id=?").get(id);
  assert.equal(after.status, "connected"); assert.equal(after.last_sync_at, null);
  assert.equal((await sync.POST(request("alice", "/api/sync", { provider: "asana" }))).status, 409);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sync_runs").get().n, 0);
});
test("blocked adapters, unknown providers, and malformed credentials cannot create connections", async () => {
  const { sqlite, connect } = await setup();
  for (const provider of ["yardi", "reapit", "arthur", "imessage", "rightmove", "whatsapp_personal"]) {
    assert.equal((await connect.POST(request("alice", "/api/integrations/connect", { provider, credentials: {} }))).status, 409);
  }
  for (const body of [null, { provider: "unknown" }, { provider: "asana", credentials: { apiKey: 7 } }, { provider: "asana", credentials: [] }, { provider: "asana", credentials: { apiKey: "  " } }]) {
    assert.equal((await connect.POST(request("alice", "/api/integrations/connect", body))).status, 400);
  }
  assert.equal(sqlite.prepare("SELECT count(*) n FROM integration_connections").get().n, 0);
});
test("provider errors do not echo secrets or mark failed verification as connected", async (t) => {
  const { sqlite, connect, verify } = await setup();
  const id = await connectKey(connect);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "rejected provider-secret" }, { status: 401 }));
  const response = await verify.POST(request("alice", "/api/integrations/verify", { connectionId: id }));
  assert.equal(response.status, 422); assert.doesNotMatch(await response.text(), /provider-secret/);
  assert.equal(sqlite.prepare("SELECT status FROM integration_connections WHERE id=?").get(id).status, "verification_failed");
});
test("a verification already in flight cannot approve replacement credentials", async (t) => {
  const { sqlite, connect, verify } = await setup();
  const id = await connectKey(connect);
  let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", async () => { started(); return new Promise(resolve => { release = resolve; }); });
  const pending = verify.POST(request("alice", "/api/integrations/verify", { connectionId: id }));
  await entered;
  await connectKey(connect, { apiKey: "replacement-secret" });
  release(Response.json({ data: { gid: "old-account", name: "Old account" } }));
  assert.equal((await pending).status, 409);
  assert.equal(sqlite.prepare("SELECT status FROM integration_connections WHERE id=?").get(id).status, "verification_required");
});
test("OAuth state is user-bound, one-use, and preserves locale while accepting long real-world tokens", async (t) => {
  const { connect, callback, oauth, sqlite } = await setup();
  const response = await connect.POST(request("alice", "/api/integrations/connect", { provider: "google_drive", returnTo: "/es-mx?view=connections" }));
  const authorize = new URL((await response.json()).authorizationUrl);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const path = `/api/oauth/callback?state=${authorize.searchParams.get("state")}&code=accepted`;
  assert.equal((await callback.GET(request("bob", path))).status, 400);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "a".repeat(2000), refresh_token: "refresh", expires_in: 3600, scope: oauth.oauthScopes("google_drive").join(" ") });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "google-user", email: "alice@example.test" });
    assert.ok(url.startsWith("https://www.googleapis.com/drive/v3/files?"));
    return Response.json({ files: [] });
  });
  const done = await callback.GET(request("alice", path));
  assert.equal(done.status, 302);
  assert.equal(new URL(done.headers.get("location")).pathname, "/es-mx");
  assert.equal((await callback.GET(request("alice", path))).status, 400);
  assert.equal(calls, 3);
  assert.equal(sqlite.prepare("SELECT status FROM integration_connections WHERE provider='google_drive'").get().status, "connected");
});
test("OAuth declines and expired states create no connection, and return paths cannot escape the site", async () => {
  const { connect, callback, oauth, sqlite } = await setup();
  for (const candidate of ["https://other.test", "//other.test", "/\\other.test", "/\n/other.test"]) assert.equal(oauth.safeReturnTo(candidate, "https://aval.test"), "/?view=connections");
  for (const expired of [false, true]) {
    const result = await (await connect.POST(request("alice", "/api/integrations/connect", { provider: "google_drive" }))).json();
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (expired) sqlite.prepare("UPDATE oauth_states SET expires_at=0 WHERE state=?").run(state);
    const response = await callback.GET(request("alice", `/api/oauth/callback?state=${state}&error=access_denied`));
    assert.equal(response.status, expired ? 400 : 302);
  }
  assert.equal(sqlite.prepare("SELECT count(*) n FROM integration_connections").get().n, 0);
});

test("live validation proves account access without installing Telegram webhooks or exposing credentials", async (t) => {
  const { connect, validate, sqlite } = await setup();
  const response = await connect.POST(request("alice", "/api/integrations/connect", { provider: "telegram", credentials: { botToken: "123:secret", webhookSecret: "webhook-secret" } }));
  const id = (await response.json()).connection.id;
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => { calls.push(url); return Response.json({ ok: true, result: { id: 123, username: "test_bot" } }); });
  assert.equal((await validate.POST(request("bob", "/api/integrations/validate", { connectionId: id }))).status, 404);
  const checked = await validate.POST(request("alice", "/api/integrations/validate", { connectionId: id }));
  assert.equal(checked.status, 200);
  assert.equal((await checked.json()).status, "passed");
  assert.deepEqual(calls, ["https://api.telegram.org/bot123:secret/getMe"]);
  const stored = sqlite.prepare("SELECT metadata_json,last_sync_at FROM integration_connections WHERE id=?").get(id);
  assert.ok(JSON.parse(stored.metadata_json).lastLiveValidationAt); assert.equal(stored.last_sync_at, null);
});

test("live validation reports upstream failure without storing a passing result", async (t) => {
  const { connect, validate, sqlite } = await setup();
  const id = await connectKey(connect);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "provider-secret" }, { status: 403 }));
  const response = await validate.POST(request("alice", "/api/integrations/validate", { connectionId: id }));
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.status, "failed"); assert.ok(!result.error.includes("provider-secret"));
  const row = sqlite.prepare("SELECT metadata_json FROM integration_connections WHERE id=?").get(id);
  assert.equal(JSON.parse(row.metadata_json).lastLiveValidationAt, undefined);
});

test("disconnect preserves import provenance and checkpoints while clearing credentials and pausing", async () => {
  const { sqlite, connect } = await setup();
  const reset = await import("../../app/api/integrations/reset/route.ts");
  const id = await connectKey(connect);
  const { organization_id: org } = sqlite.prepare("SELECT organization_id FROM integration_connections WHERE id=?").get(id);
  sqlite.prepare("UPDATE integration_connections SET status='connected',external_account_id='source-account',refresh_token_ciphertext='encrypted',last_sync_at=123 WHERE id=?").run(id);
  sqlite.prepare("INSERT INTO integration_sync_state (connection_id,organization_id,external_account_id,cursor_json,next_run_at,updated_at) VALUES (?,?,?,'{\"position\":26}',0,0)").run(id, org, "source-account");
  sqlite.prepare("INSERT INTO sync_runs (id,organization_id,connection_id,provider,status,started_at) VALUES ('historic-run',?,?,'asana','completed',0)").run(org, id);
  assert.equal((await reset.POST(request("bob", "/api/integrations/reset", { provider: "asana" }))).status, 200);
  assert.equal(sqlite.prepare("SELECT status FROM integration_connections WHERE id=?").get(id).status, "connected");
  assert.equal((await reset.POST(request("alice", "/api/integrations/reset", { provider: "asana" }))).status, 200);
  const row = sqlite.prepare("SELECT * FROM integration_connections WHERE id=?").get(id);
  assert.equal(row.status, "disconnected"); assert.equal(row.access_token_ciphertext, null); assert.equal(row.refresh_token_ciphertext, null);
  assert.equal(row.external_account_id, "source-account"); assert.equal(row.last_sync_at, 123);
  const state = sqlite.prepare("SELECT enabled,cursor_json FROM integration_sync_state WHERE connection_id=?").get(id);
  assert.equal(state.enabled, 0); assert.deepEqual(JSON.parse(state.cursor_json), { position: 26 });
  assert.equal(sqlite.prepare("SELECT connection_id FROM sync_runs WHERE id='historic-run'").get().connection_id, id);
});

test("disconnect rejects malformed bodies, cross-origin requests, and non-owner sessions", async () => {
  const { env, connect, sqlite } = await setup();
  const reset = await import("../../app/api/integrations/reset/route.ts");
  const id = await connectKey(connect);
  for (const body of [null, {}, { provider: 7 }]) assert.equal((await reset.POST(request("alice", "/api/integrations/reset", body))).status, 400);
  const crossOrigin = request("alice", "/api/integrations/reset", { provider: "asana" });
  crossOrigin.headers.set("origin", "https://other.test");
  assert.equal((await reset.POST(crossOrigin)).status, 403);
  assert.equal((await reset.POST(request(null, "/api/integrations/reset", { provider: "asana" }))).status, 401);
  env.SESSION_SECRET = "test-session-secret";
  const { organization_id: org } = sqlite.prepare("SELECT organization_id FROM integration_connections WHERE id=?").get(id);
  sqlite.prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES ('member','member@test.invalid','hash','Member',0,0)").run();
  const { upsertMembership } = await import("../../lib/organizations/membership.ts");
  await upsertMembership({ organizationId: org, userId: "member", role: "member" });
  const { createSessionCookie } = await import("../../lib/auth/session-cookie.ts");
  const member = request(null, "/api/integrations/reset", { provider: "asana" });
  member.headers.set("cookie", (await createSessionCookie({ userId: "member", email: "member@test.invalid", displayName: "Member", activeOrganizationId: org })).split(";")[0]);
  assert.equal((await reset.POST(member)).status, 403);
  assert.ok(sqlite.prepare("SELECT access_token_ciphertext FROM integration_connections WHERE id=?").get(id).access_token_ciphertext);
});
