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
async function setup() {
  const sqlite = await bootRuntime();
  const { env } = await import("cloudflare:workers");
  env.DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => sqlite.prepare(sql).get(...args) ?? null,
            all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
            run: async () => ({
              meta: { changes: sqlite.prepare(sql).run(...args).changes },
            }),
          };
        },
      };
    },
  };
  return {
    sqlite,
    route: await import("../../app/api/planning/route.ts"),
    store: await import("../../lib/planning/store.ts"),
    documents: await import("../../lib/documents/store.ts"),
  };
}
const prefs = {
  title: "Inspect roof",
  description: "Take photos",
  kind: "task",
  status: "planned",
  projectId: null,
  assigneeId: null,
  startsAt: 1000,
  endsAt: 2000,
};
function request(user, body, method = body ? "POST" : "GET") {
  return new Request("https://aval.test/api/planning", {
    method,
    headers: {
      ...(user
        ? {
            "oai-authenticated-user-id": user,
            "oai-authenticated-user-email": `${user}@example.test`,
          }
        : {}),
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("planning projects, tasks and events persist and stay inside their workspace", async () => {
  const { route } = await setup();
  const project = await (
    await route.POST(
      request("alice", {
        entity: "project",
        title: "Building improvements",
        description: "",
        color: "blue",
      }),
    )
  ).json();
  const saved = await route.POST(
    request("alice", {
      ...prefs,
      projectId: project.project.id,
      assigneeId: "alice",
      organizationId: "org_1",
    }),
  );
  assert.equal(saved.status, 201);
  const { item } = await saved.json();
  const alice = await (await route.GET(request("alice"))).json(),
    bob = await (await route.GET(request("bob"))).json();
  assert.equal(alice.items[0].id, item.id);
  assert.equal(
    alice.members.find((m) => m.userId === "alice").email,
    "alice@example.test",
  );
  assert.equal(bob.items.length, 0);
  assert.equal(bob.projects.length, 0);
  assert.equal(
    (
      await route.POST(
        request("bob", { ...prefs, projectId: project.project.id }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await route.POST(request("alice", { ...prefs, assigneeId: "bob" })))
      .status,
    400,
  );
});
test("concurrent edits have one winner; stale and cross-workspace writes do not overwrite work", async () => {
  const { route } = await setup();
  const { item } = await (await route.POST(request("alice", prefs))).json();
  const results = await Promise.all(
    ["in_progress", "completed"].map((status) =>
      route.PUT(request("alice", { ...item, status }, "PUT")),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await route.PUT(
        request("bob", { ...item, version: 2, title: "Hijacked" }, "PUT"),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await route.DELETE(
        request("alice", { id: item.id, version: 1 }, "DELETE"),
      )
    ).status,
    409,
  );
  assert.equal(
    (await route.DELETE(request("bob", { id: item.id, version: 2 }, "DELETE")))
      .status,
    409,
  );
  assert.equal(
    (
      await route.DELETE(
        request("alice", { id: item.id, version: 2 }, "DELETE"),
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await route.GET(request("alice"))).json()).items.length,
    0,
  );
});
test("anonymous planning is read-only and invalid input does not create records", async () => {
  const { route, sqlite } = await setup();
  for (const method of ["GET", "POST", "PUT", "DELETE"])
    assert.equal(
      (
        await route[method](
          request(null, method === "GET" ? undefined : prefs, method),
        )
      ).status,
      401,
    );
  assert.equal(
    (await route.POST(request("alice", { ...prefs, endsAt: 1 }))).status,
    400,
  );
  assert.equal(
    (
      await route.POST(
        request("alice", { ...prefs, description: "x".repeat(17000) }),
      )
    ).status,
    413,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM planning_items").get().n,
    0,
  );
});
test("an upload retried after a lost response stores only one document", async () => {
  const { documents, sqlite } = await setup();
  const input = {
    organizationId: "org_1",
    uploadedBy: "user_1",
    requestId: "c84d1380-953f-4af1-a52f-987043710329",
    title: "Notes.txt",
    kind: "other",
    contentText: "A real building note.",
  };
  const results = await Promise.all([
    documents.saveDocument(input),
    documents.saveDocument(input),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM documents").get().n,
    1,
  );
  await assert.rejects(() =>
    documents.saveDocument({ ...input, contentText: "Different content" }),
  );
  assert.equal(
    (await documents.getDocument("org_1", results[0].id)).contentText,
    input.contentText,
  );
  const other = await documents.saveDocument({
    ...input,
    organizationId: "org_public_demo",
  });
  assert.notEqual(other.id, results[0].id);
});
