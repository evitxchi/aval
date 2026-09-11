import assert from "node:assert/strict";
import test from "node:test";
// The wire protocol, not the adapter. Importing the adapter would pull in
// `lib/integrations/http.ts` to reach the network, and that file uses a
// TypeScript parameter property which node's strip-only mode rejects — so the
// registry half of these tests lives in the integration lane
// (tests/integration/channel-adapter.integration.mjs) and the pure half, which
// is the half worth running on every save, lives here.
import {
  parseWhatsappPayload,
  verifyWhatsappSignature,
} from "../lib/channels/whatsapp/protocol.ts";

const SECRET = "test-app-secret";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function request(signature: string | null): Request {
  const headers = new Headers();
  if (signature !== null) headers.set("x-hub-signature-256", signature);
  return new Request("https://example.com/api/webhooks/whatsapp", { method: "POST", headers });
}

// An unverified webhook is an open door into the database, and a JSON parser
// is the first thing on the other side of it.

test("a valid signature over the exact bytes verifies", async () => {
  const body = JSON.stringify({ entry: [] });
  assert.equal(await verifyWhatsappSignature(request(await sign(body)), body, SECRET), true);
});

test("a signature over different bytes is rejected", async () => {
  const signature = await sign(JSON.stringify({ entry: [] }));
  // The classic bug this prevents: verifying a re-serialised object rather
  // than the bytes that arrived. One space of difference and the HMAC fails,
  // which is the point.
  assert.equal(await verifyWhatsappSignature(request(signature), JSON.stringify({ entry: [], extra: 1 }), SECRET), false);
});

test("a missing, empty, or malformed signature is rejected", async () => {
  const body = "{}";
  for (const signature of [null, "", "sha256=", "garbage", "sha1=abc"]) {
    assert.equal(await verifyWhatsappSignature(request(signature), body, SECRET), false, String(signature));
  }
});

test("no configured secret means no verification passes", async () => {
  // Failing closed on missing configuration: a deployment that forgot the
  // secret must reject every webhook, not accept every webhook.
  const body = "{}";
  assert.equal(await verifyWhatsappSignature(request(await sign(body)), body, undefined), false);
  assert.equal(await verifyWhatsappSignature(request(await sign(body)), body, ""), false);
});

test("a signature valid under a different secret is rejected", async () => {
  const body = "{}";
  assert.equal(await verifyWhatsappSignature(request(await sign(body)), body, "a-different-secret"), false);
});

// Parsing. Meta batches, and a dropped message is a question nobody answers.

function payload(messages: unknown[], contacts: unknown[] = []) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE_ID" }, contacts, messages } }] }],
  };
}

test("every message in a batched payload is parsed", async () => {
  const parsed = parseWhatsappPayload(
    payload([
      { from: "5215512345678", id: "wamid.1", timestamp: "1789000000", text: { body: "first" } },
      { from: "5215598765432", id: "wamid.2", timestamp: "1789000001", text: { body: "second" } },
    ]),
  );
  assert.equal(parsed.length, 2, "a dropped message is a question nobody answers");
  assert.deepEqual(parsed.map((m) => m.body), ["first", "second"]);
});

test("a button tap is a message, not a discard", async () => {
  // The bug this prevents: a parser keyed on text.body silently discards every
  // confirmation, so confirm-before-execute appears to work in review and does
  // nothing in production.
  const parsed = parseWhatsappPayload(
    payload([
      {
        from: "5215512345678",
        id: "wamid.3",
        timestamp: "1789000002",
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "action:confirm:abc", title: "Send" } },
      },
    ]),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].buttonPayload, "action:confirm:abc");
  assert.equal(parsed[0].body, "Send");
});

test("a template quick-reply is parsed from its own shape", async () => {
  const parsed = parseWhatsappPayload(
    payload([
      { from: "5215512345678", id: "wamid.4", timestamp: "1789000003", button: { payload: "more", text: "More" } },
    ]),
  );
  assert.equal(parsed[0].buttonPayload, "more");
});

test("delivery receipts and reactions are not messages", async () => {
  // Replying to a read receipt would be an infinite loop with a customer's
  // phone on the other end.
  assert.deepEqual(
    parseWhatsappPayload({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "P" }, statuses: [{ status: "read" }] } }] }] }),
    [],
  );
  const media = parseWhatsappPayload(payload([{ from: "52155", id: "wamid.5", type: "image", image: { id: "x" } }]));
  assert.deepEqual(media, [], "an image is not transcribed, and pretending to have read one is worse than saying nothing");
});

test("the sender's profile name is attached when present", async () => {
  const parsed = parseWhatsappPayload(
    payload(
      [{ from: "5215512345678", id: "wamid.6", timestamp: "1789000004", text: { body: "hi" } }],
      [{ wa_id: "5215512345678", profile: { name: "Lucía" } }],
    ),
  );
  assert.equal(parsed[0].displayName, "Lucía");
});

test("a message with no name falls back to the number, not to undefined", async () => {
  const parsed = parseWhatsappPayload(payload([{ from: "5215512345678", id: "wamid.7", text: { body: "hi" } }]));
  assert.equal(parsed[0].displayName, "5215512345678");
});

test("Meta's second-precision timestamp becomes milliseconds", async () => {
  const parsed = parseWhatsappPayload(
    payload([{ from: "52155", id: "wamid.8", timestamp: "1789000000", text: { body: "hi" } }]),
  );
  assert.equal(parsed[0].sentAt.getTime(), 1789000000 * 1000);
});

test("a missing or nonsense timestamp does not produce an invalid date", async () => {
  for (const timestamp of [undefined, "", "not-a-number", "0"]) {
    const parsed = parseWhatsappPayload(payload([{ from: "52155", id: "w", timestamp, text: { body: "hi" } }]));
    assert.ok(!Number.isNaN(parsed[0].sentAt.getTime()), String(timestamp));
  }
});

test("a malformed payload returns nothing rather than throwing", async () => {
  for (const bad of [null, undefined, {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: [{}] }] }, "string"]) {
    assert.deepEqual(parseWhatsappPayload(bad), [], JSON.stringify(bad));
  }
});

