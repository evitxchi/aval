import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * A workspace on its own API key or ChatGPT/Claude subscription pays
 * OpenAI/Anthropic directly. Charging it Aval tokens as well is double-billing,
 * and blocking it at zero balance denies it a service it already pays for.
 *
 * Asserted at source level because the real behaviour needs a live D1 binding;
 * what matters is that the guard exists and is checked before the balance is,
 * which is exactly the ordering a later refactor could quietly invert.
 */

async function usageSource(): Promise<string> {
  return readFile(new URL("../lib/ask-aval/usage.ts", import.meta.url), "utf8");
}

test("the usage gate checks for an own credential before consulting Aval's balance", async () => {
  const src = await usageSource();
  const gate = src.slice(src.indexOf("export async function checkUsageBlocked"));
  const guard = gate.indexOf("usesOwnCredential");
  const balance = gate.indexOf("hasTokensRemaining");
  assert.notEqual(guard, -1, "the gate must check for a bring-your-own credential");
  assert.notEqual(balance, -1, "the gate must still check the balance for Aval-billed workspaces");
  assert.ok(guard < balance, "the own-credential check must come first, or a BYO workspace is blocked at zero balance");
});

test("a failed credential lookup keeps metering rather than silently un-metering", async () => {
  const src = await usageSource();
  const fn = src.slice(src.indexOf("async function usesOwnCredential"), src.indexOf("export async function checkUsageBlocked"));
  // The catch must return false: returning true on an error would let a
  // read failure hand out unmetered inference on Aval's own account.
  assert.match(fn, /catch[\s\S]*return false/);
});

test("usage rows for an own-credential call carry zero billable tokens", async () => {
  const src = await usageSource();
  const fn = src.slice(src.indexOf("export async function recordUsage"));
  assert.match(fn, /billable/, "recordUsage must distinguish billable from own-credential spend");
  assert.match(fn, /inputTokens: billable \? inputTokens : 0/);
  assert.match(fn, /outputTokens: billable \? outputTokens : 0/);
});
