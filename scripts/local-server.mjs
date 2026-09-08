import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const config = ["--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/aval-local-state"];
const migration = spawnSync("node", ["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "aval-local", "--local", ...config], { cwd: root, stdio: "inherit", env: { ...process.env, CI: "true" } });
if (migration.status !== 0) process.exit(migration.status ?? 1);
const child = spawn("node", ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "127.0.0.1", "--port", "3000", "--test-scheduled", ...config], { cwd: root, stdio: "inherit" });
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try { await fetch("http://127.0.0.1:3000/__scheduled?cron=*+*+*+*+*", { signal: AbortSignal.timeout(55000) }); }
  catch { /* next minute retries; durable checkpoints stay in local D1 */ }
  finally { running = false; }
}, 60000);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { clearInterval(timer); child.kill(signal); });
child.on("exit", code => { clearInterval(timer); process.exitCode = code ?? 0; });
