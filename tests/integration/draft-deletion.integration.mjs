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
    store: await import("../../lib/ask-aval/draft-store.ts"),
    route: await import("../../app/api/assistant/documents/route.ts"),
    session: await import("../../lib/integrations/session.ts"),
    organizations: await import("../../lib/integrations/organizations.ts"),
  };
}
const owner = { organizationId: "org_1", userId: "user_1" };
const input = {
  title: "Inspection report",
  instructions: "Use the workspace records",
  format: "docx",
  documentType: "Report",
  moduleLabel: "Maintenance",
};
const answer = (document = "Verified report") =>
  Response.json({ headline: "Report", document, metrics: [] });
function request(user, body, method = body ? "DELETE" : "GET") {
  return new Request("https://aval.test/api/assistant/documents", {
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
test("a deleted generating draft is erased and cannot return when the model finishes", async () => {
  const { sqlite, store } = await setup();
  const token = await store.reserveDraft(owner, "draft-active", input);
  await store.removeDrafts(owner, ["draft-active"]);
  await store.finishDraft(owner, "draft-active", token, answer());
  const row = sqlite
    .prepare("SELECT * FROM draft_documents WHERE id = ?")
    .get("draft-active");
  assert.equal(row.status, "deleted");
  assert.equal(row.document_markdown, null);
  assert.equal(row.title, "");
  assert.equal(row.instructions, "");
  assert.equal(await store.reserveDraft(owner, "draft-active", input), null);
});
test("deletion before the generation request arrives prevents resurrection", async () => {
  const { store } = await setup();
  await store.removeDrafts(owner, ["early-delete"]);
  assert.equal(await store.reserveDraft(owner, "early-delete", input), null);
});
test("an older generation attempt cannot overwrite a retried draft", async () => {
  const { sqlite, store } = await setup();
  const first = await store.reserveDraft(owner, "retry", input),
    second = await store.reserveDraft(owner, "retry", input);
  await store.finishDraft(owner, "retry", second, answer("Latest result"));
  await store.finishDraft(owner, "retry", first, answer("Stale result"));
  assert.equal(
    sqlite
      .prepare(
        "SELECT document_markdown FROM draft_documents WHERE id = 'retry'",
      )
      .get().document_markdown,
    "Latest result",
  );
});
test("delete and clear persist through reload and never remove another organization's drafts", async () => {
  const { route, store, session, organizations } = await setup();
  const alice = await session.getApiIdentity(request("alice")),
    bob = await session.getApiIdentity(request("bob"));
  await organizations.ensureOrganization(alice);
  await organizations.ensureOrganization(bob);
  for (const [identity, id] of [
    [alice, "alice-a"],
    [alice, "alice-b"],
    [bob, "bob-a"],
  ]) {
    const token = await store.reserveDraft(identity, id, input);
    await store.finishDraft(identity, id, token, answer());
  }
  assert.equal(
    (await route.DELETE(request("alice", { ids: ["alice-a", "bob-a"] })))
      .status,
    200,
  );
  assert.deepEqual(
    (await (await route.GET(request("alice"))).json()).documents.map(
      (d) => d.id,
    ),
    ["alice-b"],
  );
  assert.equal(
    (await (await route.GET(request("bob"))).json()).documents.length,
    1,
  );
  await route.DELETE(request("alice", { ids: ["alice-b"] }));
  assert.equal(
    (await (await route.GET(request("alice"))).json()).documents.length,
    0,
  );
});
test("invalid or unauthenticated delete requests cannot turn into a clear-all operation", async () => {
  const { route } = await setup();
  for (const body of [
    {},
    { all: true },
    { ids: [] },
    { ids: ["../other"] },
    { ids: [null] },
    { ids: Array(51).fill("draft") },
  ])
    assert.equal((await route.DELETE(request("alice", body))).status, 400);
  assert.equal(
    (await route.DELETE(request(null, { ids: ["draft"] }))).status,
    401,
  );
});

test("deleted drafts no longer influence learned document preferences", async () => {
  const { store } = await setup();
  const { getUsagePatternContext } =
    await import("../../lib/ask-aval/usage-patterns.ts");
  for (const id of ["report-a", "report-b", "report-c"]) {
    const token = await store.reserveDraft(owner, id, input);
    await store.finishDraft(owner, id, token, answer());
  }
  assert.match(await getUsagePatternContext(owner.organizationId), /docx/);
  await store.removeDrafts(owner, ["report-a", "report-b", "report-c"]);
  assert.equal(await getUsagePatternContext(owner.organizationId), "");
});
