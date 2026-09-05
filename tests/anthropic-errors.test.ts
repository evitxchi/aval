import assert from "node:assert/strict";
import test from "node:test";
import { anthropicFailure } from "../lib/ask-aval/anthropic-errors.ts";
import { callClaude } from "../lib/ask-aval/anthropic.ts";

test("Anthropic billing failures explain the required account action without leaking provider context", () => {
  const credit = anthropicFailure(400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. private-tenant-data" } }, "req_123");
  assert.equal(credit.code, "insufficient_credits");
  assert.equal(credit.retryable, false);
  assert.match(credit.message, /add API credits/);
  assert.match(credit.message, /req_123/);
  assert.doesNotMatch(JSON.stringify(credit), /private-tenant-data/);
  for (const status of [400, 429]) {
    const limit = anthropicFailure(status, { error: { message: "You have reached your workspace spend limit" } });
    assert.equal(limit.code, "spend_limit");
    assert.equal(limit.retryable, false);
  }
});

test("validation and authentication errors do not expose arbitrary provider messages or request IDs", () => {
  const invalid = anthropicFailure(400, { error: { message: "tools.0.input_schema invalid: confidential payload" } }, "req_123\nconfidential");
  assert.equal(invalid.code, "invalid_request");
  assert.equal(invalid.requestId, undefined);
  assert.doesNotMatch(JSON.stringify(invalid), /confidential|tools.0/);
  assert.equal(anthropicFailure(401, {}).code, "authentication_error");
  assert.equal(anthropicFailure(404, {}).code, "model_unavailable");
  assert.equal(anthropicFailure(429, {}).retryable, true);
  assert.equal(anthropicFailure(503, {}).retryable, true);
});

test("the real SDK transport preserves a safe billing diagnosis from a first-request HTTP 400", async (t) => {
  let requestCount = 0;
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  t.mock.method(globalThis, "fetch", async () => {
    requestCount++;
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. private-request-context" } }), {
      status: 400, headers: { "content-type": "application/json", "request-id": "req_transport123" },
    });
  });
  await assert.rejects(callClaude({ DB: {} as D1Database, ANTHROPIC_API_KEY: "test-credential" }, {
    system: "Test", messages: [{ role: "user", content: "Test" }],
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /insufficient_credits.*req_transport123/);
    assert.doesNotMatch(error.message, /private-request-context|test-credential/);
    return true;
  });
  assert.equal(requestCount, 1);
  assert.doesNotMatch(JSON.stringify(logs), /private-request-context|test-credential/);
});
