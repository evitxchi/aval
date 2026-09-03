import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * A taught preference is only real if it reaches whichever agent takes the
 * turn. It does today — every site that starts the Ask Aval loop appends
 * `preferenceContext` — but that is a convention three separate files have to
 * keep, and a fourth entry point added later could silently drop it, giving a
 * workspace an agent that quietly ignores what it was taught.
 *
 * This test pins the invariant at the source level: every file that invokes
 * the loop must also build preference context into the prompt it passes.
 */
const LOOP_CALLERS = [
  "lib/ask-aval/handler.ts",
  "lib/ask-aval/draft.ts",
  "lib/ask-aval/auto-reply.ts",
];

test("every entry point that starts the Ask Aval loop feeds it taught preferences", async () => {
  for (const path of LOOP_CALLERS) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /runAskAvalLoop\(/, `${path} is listed as a loop caller but doesn't call it`);
    assert.match(source, /getPreferenceContext\(/, `${path} starts the loop without loading taught preferences`);
    assert.match(source, /preferenceContext/, `${path} loads preferences but doesn't pass them into the prompt`);
  }
});

test("no unlisted file starts the Ask Aval loop", async () => {
  // If this fails, a new entry point exists: add it above *and* make sure it
  // passes preference context, rather than just widening the list.
  const { execSync } = await import("node:child_process");
  const root = new URL("..", import.meta.url).pathname;
  const found = execSync(
    `grep -rl "runAskAvalLoop(" ${root}lib ${root}app --include="*.ts" || true`,
    { encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim().replace(root, ""))
    .filter((line) => line.length > 0 && !line.endsWith("lib/ask-aval/loop.ts"))
    .sort();
  assert.deepEqual(found, [...LOOP_CALLERS].sort());
});

test("the persona registry never overrides the hard rules preferences ride alongside", async () => {
  const source = await readFile(new URL("../lib/ask-aval/personas.ts", import.meta.url), "utf8");
  // Every persona contributes framing only; the faithfulness and injection
  // rules in the base prompt stay identical for all of them.
  assert.match(source, /systemPromptAddition/);
  assert.match(source, /framing only|hard rules/i);
});
