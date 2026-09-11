import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";

/**
 * The adapter registry, with the real WhatsApp adapter loaded.
 *
 * In the integration lane rather than the unit lane because registering the
 * real adapter pulls in `lib/integrations/http.ts` to reach the network, and
 * that file uses a TypeScript parameter property node's strip-only mode
 * rejects. The wire protocol itself — signature verification and parsing — is
 * pure and tested in `tests/channel-adapter.test.ts`.
 *
 * Only `whatsapp` is implemented, on the Meta Cloud API. What these tests exist
 * to prove is the brief's narrower claim: that a *second* adapter could slot in
 * without touching agent code. Not that we plan to ship one.
 */

async function registry() {
  await bootRuntime();
  await import("../../lib/channels/whatsapp/adapter.ts");
  return import("../../lib/channels/registry.ts");
}

test("the whatsapp adapter self-registers with the right capabilities", async () => {
  const { getChannelAdapter } = await registry();
  const adapter = getChannelAdapter("whatsapp");

  assert.ok(adapter, "the adapter must register itself on import, not on a call");
  assert.equal(adapter.capabilities.buttons, true);
  assert.equal(
    adapter.capabilities.sessionWindowHours,
    24,
    "Meta's window, and the reason docs/WA_TEMPLATES.md is on the critical path",
  );
});

test("an unregistered channel resolves to null, not to a default", async () => {
  const { getChannelAdapter } = await registry();
  // Falling back to *some* adapter would mean a misconfigured channel silently
  // sending through the wrong transport.
  assert.equal(getChannelAdapter("telegram"), null);
  assert.equal(getChannelAdapter(""), null);
  assert.equal(getChannelAdapter("whatsapp_personal"), null, "the QR path must never be reachable as an adapter");
});

test("a second adapter slots in without any agent code changing", async () => {
  const { getChannelAdapter, registerChannelAdapter, registeredChannels, resetChannelAdapters } = await registry();
  // Captured before the reset below. Re-importing the adapter module to
  // restore it does not work: ESM caches modules, so a second import is a
  // no-op and the self-registration never runs again.
  const whatsapp = getChannelAdapter("whatsapp");

  // Note what this test does not import: no pipeline, no hooks, no policy, no
  // Ask Aval. Registering a transport touches the registry and nothing else,
  // which is the property the brief asks to be proven.
  registerChannelAdapter({
    id: "sms",
    verifyInbound: async () => true,
    parseInbound: () => [],
    send: async () => ({ providerId: "sid", status: "accepted" }),
    capabilities: { buttons: false, sessionWindowHours: null, maxBodyLength: 1600 },
  });

  assert.equal(getChannelAdapter("sms")?.id, "sms");
  assert.ok(registeredChannels().includes("whatsapp"));
  assert.ok(registeredChannels().includes("sms"));

  // A transport without buttons declares that rather than pretending, so the
  // renderer can degrade instead of sending a payload the provider rejects.
  assert.equal(getChannelAdapter("sms")?.capabilities.buttons, false);
  assert.equal(getChannelAdapter("sms")?.capabilities.sessionWindowHours, null);

  resetChannelAdapters();
  registerChannelAdapter(whatsapp);
});

test("re-registering the same id replaces rather than throwing", async () => {
  const { getChannelAdapter, registerChannelAdapter } = await registry();
  // A module evaluated twice is a real possibility across Worker isolates and
  // test runs. The registry is a lookup table, not a lifecycle.
  const before = getChannelAdapter("whatsapp");
  assert.doesNotThrow(() => registerChannelAdapter(before));
  assert.equal(getChannelAdapter("whatsapp")?.id, "whatsapp");
});

test("Meta's interactive limits are declared where the renderer can respect them", async () => {
  const { MAX_BUTTONS, MAX_BUTTON_LABEL } = await import("../../lib/channels/whatsapp/protocol.ts");
  assert.equal(MAX_BUTTONS, 3);
  assert.equal(MAX_BUTTON_LABEL, 20);
});
