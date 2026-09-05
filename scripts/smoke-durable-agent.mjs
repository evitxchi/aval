#!/usr/bin/env node

/**
 * Production smoke for the complete durable path:
 * HTTP enqueue -> D1 task -> background/cron worker -> model -> real read tool
 * -> persisted trace -> terminal answer. Polling here only observes state.
 */

const baseUrl = (process.argv[2] ?? process.env.AVAL_PRODUCTION_URL ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(baseUrl)) {
  console.error("Usage: node scripts/smoke-durable-agent.mjs https://production.example");
  process.exit(2);
}

// Demo access no longer exists. Exercise the real account session boundary.
const email = process.env.AVAL_SMOKE_EMAIL;
const password = process.env.AVAL_SMOKE_PASSWORD;
if (!email || !password) {
  fail("Authenticated production smoke needs AVAL_SMOKE_EMAIL and AVAL_SMOKE_PASSWORD for a dedicated verification account.", {});
}
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
if (!login.ok || !sessionCookie) fail(`Verification account login failed (${login.status})`, {});

const deadline = Date.now() + 6 * 60_000;
const created = await request("/api/agents/tasks", {
  method: "POST",
  headers: { "content-type": "application/json", "x-aval-smoke-test": "durable-agent-v1" },
  body: JSON.stringify({
    agentId: "financial",
    maxSteps: 6,
    goal: "Production verification: read the connected portfolio metrics, identify the current NOI, and conclude with only that verified figure.",
  }),
});

if (created.status !== 202 || typeof created.body?.id !== "string") {
  fail(`enqueue failed (${created.status})`, created.body);
}

const taskId = created.body.id;
let lastStatus = created.body.status;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const observed = await request(`/api/agents/tasks/${encodeURIComponent(taskId)}`);
  if (observed.status !== 200) fail(`task read failed (${observed.status})`, observed.body);
  lastStatus = observed.body?.status;
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(lastStatus)) {
    const trace = Array.isArray(observed.body?.trace) ? observed.body.trace : [];
    const kinds = new Set(trace.map((entry) => entry?.kind));
    const routedModelCall = trace.find((entry) =>
      entry?.kind === "model_call"
      && typeof entry?.modelProvider === "string" && entry.modelProvider.length > 0
      && typeof entry?.modelName === "string" && entry.modelName.length > 0
    );
    if (lastStatus !== "COMPLETED") fail(`task ended ${lastStatus}`, observed.body);
    if (!observed.body?.result) fail("completed task has no persisted result", observed.body);
    if (!kinds.has("model_call") || !kinds.has("tool_call")) {
      fail("trace does not prove model and tool execution", { taskId, kinds: [...kinds], trace });
    }
    if (!routedModelCall) {
      fail("model trace does not retain resolved provider/model provenance", { taskId, trace });
    }
    console.log(JSON.stringify({
      ok: true,
      taskId,
      status: lastStatus,
      traceRows: trace.length,
      stepsUsed: observed.body?.steps?.used,
    }));
    process.exit(0);
  }
}

fail(`task did not finish within six minutes (last status: ${lastStatus})`, { taskId });

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...init?.headers, cookie: sessionCookie } });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { nonJsonBody: text.slice(0, 500) }; }
  return { status: response.status, body };
}

function fail(message, detail) {
  console.error(JSON.stringify({ ok: false, message, detail }, null, 2));
  process.exit(1);
}
