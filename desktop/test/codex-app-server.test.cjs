"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const {
  JsonLineRpc,
  CodexAppServerService,
  answerFromText,
  assertAnswerUsesSuppliedNumbers,
  publicAccount,
  resolveCodexExecutable,
  validateAuthUrl,
} = require("../codex-app-server.cjs");

test("JSON-line RPC frames partial and multiple responses", async () => {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const rpc = new JsonLineRpc(readable, writable, { timeoutMs: 500 });
  const first = rpc.request("one", {});
  const second = rpc.request("two", {});
  readable.write('{"id":1,"result":{"ok":');
  readable.write('true}}\n{"id":2,"result":42}\n');
  assert.deepEqual(await first, { ok: true });
  assert.equal(await second, 42);
  rpc.close();
});

test("JSON-line RPC rejects pending work when the process closes", async () => {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const rpc = new JsonLineRpc(readable, writable, { timeoutMs: 5_000 });
  const request = rpc.request("wait", {});
  readable.end();
  await assert.rejects(request, /closed/i);
});

test("login URL allowlist accepts only OpenAI-owned HTTPS hosts", () => {
  assert.ok(validateAuthUrl("https://auth.openai.com/oauth/authorize"));
  assert.ok(validateAuthUrl("https://chatgpt.com/auth/login"));
  assert.equal(validateAuthUrl("http://chatgpt.com/auth/login"), null);
  assert.equal(validateAuthUrl("https://chatgpt.com.evil.example/login"), null);
  assert.equal(validateAuthUrl("javascript:alert(1)"), null);
});

test("renderer account shape cannot contain credentials", () => {
  const account = publicAccount({ type: "chatgpt", email: "owner@example.com", planType: "plus", accessToken: "never-render" });
  assert.deepEqual(account, { type: "chatgpt", email: "owner@example.com", planType: "plus" });
  assert.equal(JSON.stringify(account).includes("never-render"), false);
});

test("structured answers are validated and normalized", () => {
  const answer = answerFromText('```json\n{"headline":"Occupancy is steady","narrative":"No change is visible.","confidence":"high"}\n```');
  assert.deepEqual(answer.metrics, []);
  assert.throws(() => answerFromText('{"headline":7,"narrative":"x"}'), /incomplete/i);
});

test("answers with unsupported figures fail closed", () => {
  const verified = { headline: "Occupancy", narrative: "Occupancy is 94%.", metrics: [{ label: "Occupancy", value: 94, unit: "percent" }], confidence: "high" };
  assert.equal(assertAnswerUsesSuppliedNumbers(verified, { occupancy: 94 }), verified);
  assert.throws(
    () => assertAnswerUsesSuppliedNumbers({ ...verified, narrative: "Occupancy is 87%." }, { occupancy: 94 }),
    /not in Aval's verified facts/i,
  );
});

test("Codex executable resolution checks explicit paths without a shell", () => {
  const checked = [];
  const resolved = resolveCodexExecutable({
    env: { AVAL_CODEX_PATH: "/opt/aval/codex", PATH: "/bin" },
    platform: "darwin",
    home: "/Users/test",
    accessSync(candidate) {
      checked.push(candidate);
      if (candidate !== "/opt/aval/codex") throw new Error("missing");
    },
  });
  assert.equal(resolved, "/opt/aval/codex");
  assert.deepEqual(checked, ["/opt/aval/codex"]);
});

test("service isolates Codex, opens only the validated login URL, and returns structured answers", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aval-service-test-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  let spawnOptions;
  let openedUrl = null;
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit("exit", 0, null); };
  let inputBuffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    inputBuffer += String(chunk);
    while (inputBuffer.includes("\n")) {
      const newline = inputBuffer.indexOf("\n");
      const line = inputBuffer.slice(0, newline);
      inputBuffer = inputBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (!message.id) continue;
      let result = {};
      if (message.method === "initialize") result = { userAgent: "fake" };
      if (message.method === "account/read") result = { account: { type: "chatgpt", email: "owner@example.com", planType: "plus", accessToken: "hidden" }, requiresOpenaiAuth: true };
      if (message.method === "model/list") result = { data: [{ model: "gpt-test", displayName: "GPT Test", hidden: false, isDefault: true }], nextCursor: null };
      if (message.method === "account/rateLimits/read") result = { rateLimits: { primary: null, secondary: null, rateLimitReachedType: null, spendControlReached: false } };
      if (message.method === "account/login/start") result = { type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/oauth/authorize" };
      if (message.method === "thread/start") result = { thread: { id: "thread-1" } };
      if (message.method === "turn/start") result = { turn: { id: "turn-1" } };
      child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      if (message.method === "turn/start") {
        queueMicrotask(() => {
          child.stdout.write(`${JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: '{"headline":"Verified","narrative":"The supplied facts support this.","metrics":[],"confidence":"high"}' } })}\n`);
          child.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [], error: null } } })}\n`);
        });
      }
    }
  });

  const service = new CodexAppServerService({
    userDataDir: temporary,
    env: { PATH: "/fake", OPENAI_API_KEY: "must-not-leak" },
    spawnImpl(_command, _args, options) { spawnOptions = options; return child; },
    openExternal: async (url) => { openedUrl = url; },
  });
  // The fake executable resolver needs one explicit path it can stat. This
  // test uses the current Node binary as a harmless executable placeholder;
  // spawnImpl above prevents it from actually launching.
  service.env.AVAL_CODEX_PATH = process.execPath;
  await service.start();
  assert.equal(spawnOptions.shell, false);
  assert.equal(spawnOptions.env.OPENAI_API_KEY, undefined);
  assert.equal(spawnOptions.env.CODEX_HOME, path.join(temporary, "codex-home"));
  assert.deepEqual(service.getState().account, { type: "chatgpt", email: "owner@example.com", planType: "plus" });
  await service.connect();
  assert.equal(openedUrl, "https://auth.openai.com/oauth/authorize");
  assert.equal(JSON.stringify(service.getState()).includes("oauth/authorize"), false);
  await service.setActive(true);
  const answer = await service.ask({ conversationId: "test", question: "What changed?", locale: "en", context: { facts: { occupancy: 94 } } });
  assert.equal(answer.headline, "Verified");
  service.stop();
});
