import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { bootRuntime } from "./harness.mjs";

// Next's package has no ESM subpath export for headers; keep its real module.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });

async function setup() {
  const sqlite = await bootRuntime();
  const { env } = await import("cloudflare:workers");
  // Execute the real D1 SQL against the migrated database.
  env.DB = {
    prepare(sql) {
      return { bind(...params) {
        return {
          first: async () => sqlite.prepare(sql).get(...params) ?? null,
          all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
          run: async () => sqlite.prepare(sql).run(...params),
        };
      } };
    },
  };
  const route = await import("../../app/api/appearance/route.ts");
  const storage = await import("../../lib/appearance-storage.ts");
  return { sqlite, route, storage, env };
}
const avatar = { kind: "portrait", id: "14-high-bun", background: "mint" };
const prefs = { profile: avatar, agents: { general: avatar }, motion: "still" };
function request(user, body) {
  return new Request("https://aval.test/api/appearance", {
    method: body === undefined ? "GET" : "PUT",
    headers: { ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("appearance persists to the authenticated account and cannot target another account", async () => {
  const { route, sqlite } = await setup();
  assert.equal((await route.PUT(request("alice", { ...prefs, userId: "bob" }))).status, 200);
  assert.deepEqual((await (await route.GET(request("alice"))).json()).appearance, prefs);
  assert.deepEqual((await (await route.GET(request("bob"))).json()).appearance, { profile: null, agents: {}, motion: "system" });
  assert.equal(sqlite.prepare("SELECT count(*) AS total FROM user_appearance").get().total, 1);
  const replacement = { ...prefs, profile: null, motion: "system" };
  assert.equal((await route.PUT(request("alice", replacement))).status, 200);
  assert.deepEqual((await (await route.GET(request("alice"))).json()).appearance, replacement);
});

test("guest requests never read or change the shared demo account's appearance", async () => {
  const { route, sqlite } = await setup();
  assert.equal((await route.GET(request(null))).status, 401);
  assert.equal((await route.PUT(request(null, prefs))).status, 401);
  assert.equal(sqlite.prepare("SELECT count(*) AS total FROM user_appearance").get().total, 0);
});

test("invalid or oversized appearance is rejected without altering the previous save", async () => {
  const { route } = await setup();
  await route.PUT(request("alice", prefs));
  assert.equal((await route.PUT(request("alice", { ...prefs, profile: { ...avatar, id: "https://evil.test" } }))).status, 400);
  assert.equal((await route.PUT(request("alice", { ...prefs, extra: "x".repeat(21000) }))).status, 413);
  assert.deepEqual((await (await route.GET(request("alice"))).json()).appearance, prefs);
});

test("team avatar lookup exposes only requested profile pictures, including empty rosters", async () => {
  const { storage } = await setup();
  await storage.writeAppearance("alice", prefs);
  await storage.writeAppearance("outsider", { ...prefs, profile: { ...avatar, background: "sky" } });
  const result = await storage.memberProfileAvatars(["alice", "no-avatar"]);
  assert.deepEqual([...result.entries()], [["alice", avatar]]);
  assert.equal((await storage.memberProfileAvatars([])).size, 0);
});

test("storage failure returns a retryable error instead of claiming a save succeeded", async () => {
  const { env, route } = await setup();
  env.DB = { prepare() { throw new Error("offline"); } };
  assert.equal((await route.PUT(request("alice", prefs))).status, 503);
  assert.equal((await route.GET(request("alice"))).status, 503);
});
