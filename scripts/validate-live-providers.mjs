/** Run against an authenticated workspace; never print credentials or provider payloads. */
const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const url = new URL(origin);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use HTTPS or loopback for provider validation");
const headers = process.env.AVAL_SESSION_COOKIE ? { cookie: process.env.AVAL_SESSION_COOKIE } : {};
const response = await fetch(new URL("/api/integrations", url), { headers, signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Sign in to the target workspace before validation (${response.status})`);
const catalog = await response.json();
if (catalog.storage === "unavailable") throw new Error("Workspace storage is unavailable");
const candidates = catalog.providers.filter(provider => provider.connection?.status === "connected" && provider.category !== "Model");
const results = [];
for (const provider of candidates) {
  const check = await fetch(new URL("/api/integrations/validate", url), { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ connectionId: provider.connection.id }), signal: AbortSignal.timeout(60000) });
  const result = await check.json();
  results.push({ provider: provider.id, status: result.status ?? "failed", checkedAt: result.checkedAt ?? null, error: result.error ?? null });
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), connectedProviders: candidates.length, status: candidates.length ? results.every(row => row.status === "passed") ? "passed" : "incomplete" : "blocked_no_connected_providers", results }, null, 2));
if (!candidates.length || results.some(row => row.status !== "passed")) process.exitCode = 2;
