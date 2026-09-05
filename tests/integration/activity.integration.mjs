import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { bootRuntime } from "./harness.mjs";
registerHooks({
  resolve(specifier, context, next) {
    return next(
      specifier === "next/headers" ? "next/headers.js" : specifier,
      context,
    );
  },
});
test("usage persistence deduplicates minutes, isolates users and organizations, and aggregates UTC days", async () => {
  const sqlite = await bootRuntime();
  const { recordActivity, readActivity } =
    await import("../../lib/activity/store.ts");
  const first = new Date("2026-09-04T23:59:01Z"),
    second = new Date("2026-09-05T00:00:01Z");
  await recordActivity("org_1", "alice", first);
  await recordActivity("org_1", "alice", new Date(+first + 15000));
  await recordActivity("org_1", "alice", second);
  await recordActivity("org_1", "bob", second);
  await recordActivity("org_public_demo", "alice", second);
  const history = await readActivity("org_1", "alice", second);
  assert.deepEqual(history.days, [
    { date: "2026-09-04", minutes: 1 },
    { date: "2026-09-05", minutes: 1 },
  ]);
  assert.equal((await readActivity("org_1", "bob", second)).days.length, 1);
  assert.equal((await readActivity("org_1", "nobody", second)).days.length, 0);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM workspace_usage").get().n,
    4,
  );
});
test("usage API denies anonymous and cross-origin writes and ignores client-provided subjects/timestamps", async () => {
  const sqlite = await bootRuntime();
  const route = await import("../../app/api/workspace/activity/route.ts");
  const make = (headers = {}, method = "POST") =>
    new Request("https://aval.test/api/workspace/activity", {
      method,
      headers,
      ...(method === "POST"
        ? {
            body: JSON.stringify({
              userId: "victim",
              organizationId: "org_1",
              timestamp: "1999-01-01",
            }),
          }
        : {}),
    });
  assert.equal((await route.POST(make())).status, 401);
  const auth = {
    "oai-authenticated-user-id": "alice",
    "oai-authenticated-user-email": "alice@example.test",
  };
  assert.equal(
    (await route.POST(make({ ...auth, origin: "https://evil.test" }))).status,
    403,
  );
  assert.equal(
    (await route.POST(make({ ...auth, origin: "https://aval.test" }))).status,
    200,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) AS n FROM workspace_usage WHERE user_id = 'victim'",
      )
      .get().n,
    0,
  );
  const response = await route.GET(make(auth, "GET"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).days.length, 1);
});
