import assert from "node:assert/strict";
import test from "node:test";
import { boundToolResult, MAX_TOOL_RESULT_CHARS } from "../lib/agents/output-bounds.ts";
import { redactArguments } from "../lib/agents/redaction.ts";
import { validateToolArguments, type SchemaLike } from "../lib/agents/tool-schema.ts";

/**
 * The three controls that stand between a model-authored proposal and the
 * runtime: is the call well formed, is its result a sane size, and is what
 * lands on the approval card safe to show.
 *
 * All three failed an adversarial audit on 2026-09-04 — arguments were never
 * checked against the schema the model is shown, a result of any size reached
 * the model, and redaction dropped long strings rather than sensitive ones.
 */

/* ── argument validation ─────────────────────────────────────────────────── */

const PREFERENCE: SchemaLike = {
  type: "object",
  properties: {
    topic: { type: "string", enum: ["vendor_selection", "reporting"] },
    statement: { type: "string", enum: ["always_compare_multiple_quotes"] },
  },
  required: ["topic", "statement"],
};

test("a well-formed call passes", () => {
  assert.deepEqual(
    validateToolArguments(PREFERENCE, { topic: "vendor_selection", statement: "always_compare_multiple_quotes" }),
    { ok: true },
  );
});

test("the exact malformed call the audit found is refused", () => {
  const verdict = validateToolArguments(PREFERENCE, { statement: 12345, scope: {} });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.problems.length, 3, verdict.problems.join(" "));
  assert.match(verdict.problems.join(" "), /Missing required argument "topic"/);
  assert.match(verdict.problems.join(" "), /"statement" is not one of the permitted values/);
  assert.match(verdict.problems.join(" "), /Unknown argument "scope"/);
});

test("an undeclared argument is refused rather than ignored", () => {
  // Silently dropping it would hide a model that misunderstood the tool, and
  // would give retrieved text that smuggles a field a quiet path through.
  const verdict = validateToolArguments(PREFERENCE, {
    topic: "reporting", statement: "always_compare_multiple_quotes", organization_id: "org_2",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /Unknown argument "organization_id"/);
});

test("a float cannot pass as an integer amount", () => {
  const money: SchemaLike = { type: "object", properties: { amount_cents: { type: "integer" } }, required: ["amount_cents"] };
  assert.equal(validateToolArguments(money, { amount_cents: 1200 }).ok, true);
  const verdict = validateToolArguments(money, { amount_cents: 12.005 });
  assert.equal(verdict.ok, false, "a truncated fraction of a cent is exactly the rounding nobody notices");
});

test("a missing schema fails closed rather than waving the call through", () => {
  const verdict = validateToolArguments(undefined, { anything: 1 });
  assert.equal(verdict.ok, false);
});

test("non-object arguments are refused", () => {
  for (const value of [null, "a string", 42, ["x"]]) {
    assert.equal(validateToolArguments(PREFERENCE, value).ok, false, `${JSON.stringify(value)} must not validate`);
  }
});

test("a flood of problems is capped", () => {
  const wide: SchemaLike = { type: "object", properties: {} };
  const args = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, "x"]));
  const verdict = validateToolArguments(wide, args);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.length <= 7, `reported ${verdict.problems.length} problems`);
  assert.match(verdict.problems.at(-1) ?? "", /more/);
});

/* ── output bounds ───────────────────────────────────────────────────────── */

test("a small result passes through untouched", () => {
  const json = { title: "Lease", text: "short" };
  const bounded = boundToolResult(json);
  assert.equal(bounded.truncated, false);
  assert.deepEqual(bounded.json, json);
});

test("an oversized document is bounded and says so", () => {
  const bounded = boundToolResult({ title: "Master Lease", text: "A".repeat(2_000_000) });
  assert.equal(bounded.truncated, true);
  assert.ok(JSON.stringify(bounded.json).length <= MAX_TOOL_RESULT_CHARS, "result must fit the ceiling");
  const json = bounded.json as { title: string; text: string };
  assert.match(json.text, /truncated: .* characters withheld/);
  assert.match(json.text, /incomplete/, "the model must be told, or it will conclude from a partial document");
  assert.equal(json.title, "Master Lease", "structure and short fields survive");
});

test("bounding trims the largest field, not the whole structure", () => {
  const bounded = boundToolResult({ id: "doc_1", kind: "lease", body: "B".repeat(2_000_000), as_of: "2026-09-04" });
  const json = bounded.json as { id: string; kind: string; as_of: string };
  assert.equal(json.id, "doc_1");
  assert.equal(json.kind, "lease");
  assert.equal(json.as_of, "2026-09-04", "sibling fields the caller reads must survive intact");
});

test("bounding does not mutate the caller's object", () => {
  const original = { text: "C".repeat(2_000_000) };
  boundToolResult(original);
  assert.equal(original.text.length, 2_000_000);
});

/* ── redaction ───────────────────────────────────────────────────────────── */

test("the resident's name the docstring names is withheld", () => {
  const out = redactArguments({ tenant_name: "Jane Doe", note: "Resident Jane Doe, unit 4B, owes $412,806" });
  assert.equal(out.tenant_name, "<redacted:8>");
  assert.equal(out.note, "<string:41>", "free-text prose under a benign key is where a name hides");
});

test("credentials and personal identifiers are withheld whatever the key", () => {
  const out = redactArguments({
    api_key: "sk-live-CANARY123456",
    passthrough: "sk_live_abcdefgh1234",
    ssn: "123-45-6789",
    whoever: "jane@example.com",
    auth: "Bearer abcdefghijklmnop",
  });
  for (const [key, value] of Object.entries(out)) {
    assert.match(String(value), /^<redacted:\d+>$/, `${key} leaked as ${value}`);
  }
});

test("the facts an approver decides on survive", () => {
  const out = redactArguments({ amount_cents: 412806, currency: "USD", destination_account_id: "acct_1", unit_id: "u-4B" });
  assert.deepEqual(out, { amount_cents: 412806, currency: "USD", destination_account_id: "acct_1", unit_id: "u-4B" });
});

test("a declared enum stays legible even when it reads as prose", () => {
  const schema = { properties: { statement: { type: "string", enum: ["always compare multiple quotes"] } } };
  // A fixed vocabulary the backend wrote cannot carry a resident's name, so
  // the whitespace rule would only make the approval card less readable.
  assert.equal(redactArguments({ statement: "always compare multiple quotes" }, schema).statement, "always compare multiple quotes");
  assert.equal(redactArguments({ statement: "always compare multiple quotes" }).statement, "<string:30>");
});

test("an enum declaration cannot un-redact a sensitive key", () => {
  const schema = { properties: { api_key: { type: "string", enum: ["sk-live-CANARY123456"] } } };
  assert.equal(redactArguments({ api_key: "sk-live-CANARY123456" }, schema).api_key, "<redacted:20>");
});

test("shape survives so an approver still sees what was asked for", () => {
  const out = redactArguments({ tenant_name: "Jane Doe", rows: [1, 2, 3], nested: { a: 1 }, flag: true });
  assert.deepEqual(Object.keys(out), ["tenant_name", "rows", "nested", "flag"]);
  assert.equal(out.rows, "<array:3>");
  assert.equal(out.nested, "<object>");
  assert.equal(out.flag, true);
});
