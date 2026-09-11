import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";

/**
 * The pipeline end to end, against real storage.
 *
 * These are the brief's acceptance criteria stated as assertions:
 * unlinked numbers cost no model call, linking works dashboard → confirmed
 * reply, three roles reach three tool sets, a duplicate message id produces
 * one reply, and a write proposes before it executes.
 */

const NOW = Date.now();

async function setup() {
  const sqlite = await bootRuntime();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);

  run("INSERT OR IGNORE INTO organizations (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)", "org_a", "Alpha Properties", "user_a", NOW, NOW);
  run("INSERT OR IGNORE INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)", "user_a", "a@example.com", "h", "A", NOW, NOW);

  const pipeline = await import("../../lib/channels/pipeline.ts");
  const queue = await import("../../lib/channels/queue.ts");
  return { sqlite, run, pipeline, queue };
}

function inbound(overrides = {}) {
  return {
    channel: "whatsapp",
    from: "+525512345678",
    to: "PHONE_ID",
    externalMessageId: `wamid.${Math.random().toString(36).slice(2)}`,
    externalThreadId: "525512345678",
    body: "how much have I collected this month?",
    displayName: "Operator",
    sentAt: new Date(NOW),
    ...overrides,
  };
}

/** Counts calls so "no model call" can be asserted directly rather than inferred. */
function spyDeps(answer = { headline: "Collected", narrative: "You collected $28,500.", metrics: [{ label: "Collected", value: 28500, unit: "currency" }] }) {
  const calls = [];
  return {
    calls,
    deps: {
      ask: async (input) => {
        calls.push(input);
        return { answer, toolsUsed: ["get_accounting_breakdown"] };
      },
      readOverflow: async () => null,
    },
  };
}

function linkIdentity(run, { externalId, role = "owner", locale = "en", id = "ci_1" }) {
  run(
    "INSERT INTO channel_identities (id,organization_id,user_id,contact_id,channel,external_id,role,locale,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, "org_a", "user_a", null, "whatsapp", externalId, role, locale, NOW, NOW,
  );
}

test("an unlinked number gets one canned reply and zero model calls", async () => {
  const { pipeline } = await setup();
  const { calls, deps } = spyDeps();

  const outcome = await pipeline.handleInbound(inbound(), deps);

  assert.equal(outcome.reason, "unlinked");
  assert.equal(outcome.modelCalled, false);
  assert.equal(calls.length, 0, "an unlinked number must not be able to spend our tokens");
  assert.ok(outcome.reply?.body.includes("isn't linked"));
});

test("an unparseable number is treated exactly like an unknown one", async () => {
  const { pipeline } = await setup();
  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(inbound({ from: "not-a-number" }), deps);
  assert.equal(outcome.modelCalled, false);
  assert.equal(calls.length, 0);
});

test("linking works end to end and the confirmation names the org and role", async () => {
  const { run, pipeline } = await setup();
  run("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
    "ABCD2345", "org_a", "user_a", "owner", "en", NOW + 900000, NOW);

  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(inbound({ body: "AVAL-LINK ABCD2345" }), deps);

  assert.equal(outcome.reason, "linked");
  assert.equal(outcome.modelCalled, false, "linking is a state change, not a question");
  assert.equal(calls.length, 0);
  assert.ok(outcome.reply.body.includes("Alpha Properties"), "the confirmation must name the workspace");
  assert.ok(outcome.reply.body.includes("owner"), "and the role");
  // The first post-link message lists the example commands verbatim.
  assert.ok(outcome.reply.body.includes("How much have I collected this month?"));
  assert.ok(outcome.reply.buttons.length > 0);
});

test("an expired code gets a plain refusal and no fallback to phone matching", async () => {
  const { run, pipeline } = await setup();
  run("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
    "EXPRED22", "org_a", "user_a", "owner", "en", NOW - 1000, NOW - 100000);

  // Note the code alphabet excludes I, L, O and U — they are misread off a
  // screen — so a valid code can never contain them.
  const outcome = await pipeline.handleInbound(inbound({ body: "AVAL-LINK EXPRED22" }), spyDeps().deps);
  assert.equal(outcome.reason, "link_failed");
  assert.ok(outcome.reply.body.includes("expired"));
});

test("help costs no model call, in either locale", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678" });
  linkIdentity(run, { externalId: "+525599999999", locale: "es-mx", id: "ci_2" });

  for (const [from, body, marker] of [
    ["+525512345678", "help", "What you can ask me"],
    ["+525599999999", "ayuda", "Lo que puedes preguntarme"],
  ]) {
    const { calls, deps } = spyDeps();
    const outcome = await pipeline.handleInbound(inbound({ from, body }), deps);
    assert.equal(outcome.reason, "help", body);
    assert.equal(calls.length, 0, `${body} must not cost a model call`);
    assert.ok(outcome.reply.body.includes(marker), `${body} must answer in locale`);
  }
});

test("a linked operator's question reaches the model and renders with buttons", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678" });

  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(inbound(), deps);

  assert.equal(outcome.reason, "answered");
  assert.equal(outcome.modelCalled, true);
  assert.equal(calls.length, 1);
  // org and role are resolved before the model runs, never supplied by it.
  assert.equal(calls[0].identity.organizationId, "org_a");
  assert.equal(calls[0].identity.role, "owner");
  assert.ok(outcome.reply.body.includes("$28,500"), "the figure must match the dashboard's formatting");
  assert.ok(outcome.reply.buttons.length > 0, "every answer carries buttons");
});

test("a resident is handed to a human without a model call", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678", role: "resident" });

  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(inbound({ body: "what do I owe?" }), deps);

  assert.equal(outcome.reason, "resident_handoff");
  assert.equal(calls.length, 0, "a resident must never reach a portfolio tool");
});

test("a duplicate message id produces one queued event, and so one reply", async () => {
  const { queue } = await setup();
  const message = inbound();

  assert.equal(await queue.enqueueInbound(message, "org_a"), true);
  assert.equal(await queue.enqueueInbound(message, "org_a"), false, "Meta redelivers; the second must be a no-op");

  const claimed = await queue.claimInboundEvents(10);
  assert.equal(claimed.length, 1);
});

test("a claimed event is not claimed twice", async () => {
  const { queue } = await setup();
  await queue.enqueueInbound(inbound(), "org_a");

  const first = await queue.claimInboundEvents(10);
  assert.equal(first.length, 1);
  const second = await queue.claimInboundEvents(10);
  assert.equal(second.length, 0, "an in-flight event must not be picked up by a second worker");
});

test("MORE returns held text without a model call", async () => {
  const { run, pipeline, queue } = await setup();
  linkIdentity(run, { externalId: "+525512345678" });
  await queue.storeOverflow("ci_1", "org_a", "the rest of the answer");

  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(inbound({ body: "MORE" }), {
    ...deps,
    readOverflow: queue.readOverflow,
  });

  assert.equal(outcome.reason, "more");
  assert.equal(calls.length, 0, "the text is already ours; asking again would be paying twice");
  assert.ok(outcome.reply.body.includes("the rest of the answer"));
});

test("a write proposes, previews per recipient, and executes only on confirm", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678", role: "owner" });
  const actions = await import("../../lib/channels/actions.ts");

  const { action, buttons } = await actions.proposeAction({
    organizationId: "org_a",
    channelIdentityId: "ci_1",
    tool: "send_external_message",
    args: { template: "reminder" },
    recipients: [
      { label: "Lucía R.", destination: "+525511110000", detail: "$9,500" },
      { label: "Marco T.", destination: "+525522220000", detail: "$12,000" },
      { label: "Ana P.", destination: "+525533330000", detail: "$7,000" },
    ],
    summary: "3 tenants at Riverside are 30+ days late, $28,500.",
  });

  // Nothing has run yet.
  const stored = await actions.loadPendingAction(action.id, "ci_1");
  assert.ok(stored, "the proposal is durable, not held in memory");
  assert.equal(stored.recipients.length, 3);
  assert.ok(buttons.some((b) => b.id.startsWith("action:list")), "a batch must be reviewable");

  let executed = 0;
  const deps = {
    ...spyDeps().deps,
    actions: {
      load: actions.loadPendingAction,
      claim: actions.claimAction,
      cancel: actions.cancelAction,
      drop: actions.dropRecipient,
      execute: async () => {
        executed += 1;
        return { ok: true, reversible: false };
      },
      undo: async () => ({ outcome: "not_reversible" }),
    },
  };

  // Reviewing the batch shows every recipient and sends nothing.
  const preview = await pipeline.handleInbound(
    inbound({ body: "See all 3", buttonPayload: `action:list:${action.id}` }),
    deps,
  );
  assert.equal(preview.reason, "action_previewed");
  assert.equal(executed, 0, "previewing must not execute");
  assert.ok(preview.reply.body.includes("Lucía R."));
  assert.ok(!preview.reply.body.includes("+525511110000"), "a full number must not be printed into a chat");

  // Dropping one leaves two.
  const dropped = await pipeline.handleInbound(
    inbound({ body: "drop", buttonPayload: `action:drop:${action.id}:1` }),
    deps,
  );
  assert.equal(dropped.reason, "action_previewed");
  assert.ok(!dropped.reply.body.includes("Marco T."), "the dropped recipient must be gone");
  assert.ok(dropped.reply.body.includes("Lucía R."));

  // Confirming runs it exactly once.
  const confirmed = await pipeline.handleInbound(
    inbound({ body: "Send", buttonPayload: `action:confirm:${action.id}` }),
    deps,
  );
  assert.equal(confirmed.reason, "action_confirmed");
  assert.equal(executed, 1);
  // A sent message cannot be unsent, so no undo is offered.
  assert.equal(confirmed.reply.buttons.length, 0);

  // A second tap does nothing.
  const again = await pipeline.handleInbound(
    inbound({ body: "Send", buttonPayload: `action:confirm:${action.id}` }),
    deps,
  );
  assert.equal(executed, 1, "a double tap must not send twice");
  assert.equal(again.reason, "action_expired");
});

test("a coordinator can propose but cannot confirm", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678", role: "member" });
  const actions = await import("../../lib/channels/actions.ts");

  const { action } = await actions.proposeAction({
    organizationId: "org_a",
    channelIdentityId: "ci_1",
    tool: "send_external_message",
    args: {},
    summary: "one reminder",
  });

  let executed = 0;
  const outcome = await pipeline.handleInbound(
    inbound({ body: "Send", buttonPayload: `action:confirm:${action.id}` }),
    {
      ...spyDeps().deps,
      actions: {
        load: actions.loadPendingAction,
        claim: actions.claimAction,
        cancel: actions.cancelAction,
        drop: actions.dropRecipient,
        execute: async () => {
          executed += 1;
          return { ok: true, reversible: false };
        },
        undo: async () => ({ outcome: "unknown" }),
      },
    },
  );

  assert.equal(outcome.reason, "action_refused");
  assert.equal(executed, 0, "separation of duties must hold on the channel too");
});

test("another identity's action id is inert", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678", role: "owner", id: "ci_1" });
  linkIdentity(run, { externalId: "+525599999999", role: "owner", id: "ci_other" });
  const actions = await import("../../lib/channels/actions.ts");

  // Proposed by someone else.
  const { action } = await actions.proposeAction({
    organizationId: "org_a",
    channelIdentityId: "ci_other",
    tool: "send_external_message",
    args: {},
    summary: "not yours",
  });

  let executed = 0;
  const outcome = await pipeline.handleInbound(
    inbound({ from: "+525512345678", body: "Send", buttonPayload: `action:confirm:${action.id}` }),
    {
      ...spyDeps().deps,
      actions: {
        load: actions.loadPendingAction,
        claim: actions.claimAction,
        cancel: actions.cancelAction,
        drop: actions.dropRecipient,
        execute: async () => {
          executed += 1;
          return { ok: true, reversible: true };
        },
        undo: async () => ({ outcome: "unknown" }),
      },
    },
  );

  assert.equal(executed, 0, "a forwarded button must be inert in someone else's hands");
  assert.equal(outcome.reason, "action_expired");
});

test("a garbage button payload is dropped, not interpreted", async () => {
  const { run, pipeline } = await setup();
  linkIdentity(run, { externalId: "+525512345678" });

  const { calls, deps } = spyDeps();
  const outcome = await pipeline.handleInbound(
    inbound({ body: "x", buttonPayload: "action:confirm:../../etc/passwd" }),
    deps,
  );

  assert.equal(outcome.reason, "ignored");
  assert.equal(calls.length, 0);
  assert.equal(outcome.reply, null);
});
