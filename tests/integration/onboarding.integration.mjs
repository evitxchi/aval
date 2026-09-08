import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { bootRuntime } from "./harness.mjs";
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
async function setup() {
  const sqlite = await bootRuntime();
  return { sqlite, route: await import("../../app/api/preferences/route.ts"), storage: await import("../../lib/onboarding/storage.ts"), rules: await import("../../lib/onboarding/preferences.ts") };
}
function request(user, body, origin) {
  return new Request("https://aval.test/api/preferences", { method: body === undefined ? "GET" : "PUT", headers: {
    ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` } : {}),
    ...(origin ? { origin } : {}), "content-type": "application/json",
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("onboarding resumes saved steps and rejects stale tabs, including a first-save race", async () => {
  const { route, rules } = await setup();
  const initial = structuredClone(rules.DEFAULT_ONBOARDING);
  initial.preferences.focus = ["maintenance"];
  initial.step = 2;
  const responses = await Promise.all([route.PUT(request("alice", initial)), route.PUT(request("alice", initial))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const saved = await (await route.GET(request("alice"))).json();
  assert.equal(saved.step, 2); assert.equal(saved.revision, 1);
  assert.deepEqual(saved.preferences.focus, ["maintenance"]);
  assert.equal((await route.PUT(request("alice", { ...saved, completed: true, step: 6 }))).status, 200);
  assert.equal((await route.PUT(request("alice", saved))).status, 409);
  assert.equal((await (await route.GET(request("alice"))).json()).completed, true);
});
test("onboarding cannot target another user or workspace and requires authentication", async () => {
  const { route, rules, storage } = await setup();
  assert.equal((await route.PUT(request("alice", { ...rules.DEFAULT_ONBOARDING, completed: true, userId: "bob", organizationId: "org_1" }))).status, 200);
  assert.equal((await (await route.GET(request("bob"))).json()).completed, false);
  assert.equal((await storage.readOnboarding("alice", "org_1")).completed, false);
  assert.equal((await route.GET(request(null))).status, 401);
  assert.equal((await route.PUT(request(null, rules.DEFAULT_ONBOARDING))).status, 401);
  assert.equal((await route.PUT(request("alice", rules.DEFAULT_ONBOARDING, "https://other.test"))).status, 403);
});
test("invalid choices and oversized requests never persist", async () => {
  const { route, rules, sqlite } = await setup();
  for (const patch of [{ step: -1 }, { step: 7 }, { revision: 0.1 }, { completed: "true" }, { preferences: { ...rules.DEFAULT_PREFERENCES, focus: ["all", "maintenance"] } }, { preferences: { ...rules.DEFAULT_PREFERENCES, autonomy: ["supervised", "autonomous"] } }, { preferences: { ...rules.DEFAULT_PREFERENCES, pms: ["made-up"] } }]) {
    assert.equal((await route.PUT(request("alice", { ...rules.DEFAULT_ONBOARDING, ...patch }))).status, 400);
  }
  assert.equal((await route.PUT(request("alice", { ...rules.DEFAULT_ONBOARDING, padding: "x".repeat(12000) }))).status, 413);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM user_onboarding").get().n, 0);
});
test("saved choices enter assistant context without changing permissions", async () => {
  const { storage, rules } = await setup();
  assert.equal(await storage.onboardingContext("user_1", "org_1"), "");
  await storage.writeOnboarding("user_1", "org_1", { ...rules.DEFAULT_ONBOARDING, completed: true, step: 6, preferences: { ...rules.DEFAULT_PREFERENCES, autonomy: ["autonomous"], focus: ["leasing"] } });
  const context = await storage.onboardingContext("user_1", "org_1");
  assert.match(context, /leasing/); assert.match(context, /do not grant tool permissions/); assert.match(context, /approval and execution policies still apply/);
  assert.equal(await storage.onboardingContext("user_2", "org_1"), "");
});
test("storage failures return retryable errors and never reset saved choices", async () => {
  const { route, rules, sqlite } = await setup();
  sqlite.exec("DROP TABLE user_onboarding");
  assert.equal((await route.GET(request("alice"))).status, 503);
  assert.equal((await route.PUT(request("alice", rules.DEFAULT_ONBOARDING))).status, 503);
});
