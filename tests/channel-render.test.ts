import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BODY,
  MAX_EVIDENCE_ROWS,
  buildButtons,
  renderAnswer,
  toWhatsappMarkup,
  truncate,
  type AskAnswer,
} from "../lib/channels/whatsapp/render.ts";
import { defaultTerms } from "../lib/channels/vocabulary.ts";
import { formatMetricValue } from "../lib/ask-aval/format-metric.ts";
import { suggestionsFor, questionForSuggestion } from "../lib/channels/suggestions.ts";

const TERMS = defaultTerms("en");

const ANSWER: AskAnswer = {
  headline: "Collections are ahead of last month",
  narrative: "You have collected $28,500 so far, up from $24,100. Three residents remain outstanding.",
  metrics: [
    { label: "Collected", value: 28500, unit: "currency", delta: 18.3 },
    { label: "Outstanding", value: 3, unit: "count" },
  ],
  evidence_ids: ["resident:Lucía R.", "resident:Marco T.", "resident:Ana P."],
  confidence: "high",
};

test("an answer renders headline, figures one per line, then narrative", () => {
  const { body } = renderAnswer({ answer: ANSWER, locale: "en", terms: TERMS });
  const lines = body.split("\n");
  assert.equal(lines[0], "*Collections are ahead of last month*");
  assert.ok(body.includes("Collected: *$28,500* (+18.3%)"));
  assert.ok(body.includes("Outstanding: *3*"));
  // Each figure gets its own line — a phone is a narrow column.
  assert.ok(!/Collected.*Outstanding/.test(body.split("\n").find((l) => l.startsWith("Collected")) ?? ""));
});

test("figures match the dashboard's formatting exactly", () => {
  // The acceptance criterion is that a figure read over WhatsApp is the same
  // figure as on screen. Both call the same formatter, and this pins it.
  const { body } = renderAnswer({ answer: ANSWER, locale: "en", terms: TERMS });
  for (const metric of ANSWER.metrics ?? []) {
    assert.ok(body.includes(formatMetricValue(metric)), `${metric.label} must render as the dashboard renders it`);
  }
});

test("only WhatsApp's own markup survives", () => {
  assert.equal(toWhatsappMarkup("**bold**"), "*bold*");
  assert.equal(toWhatsappMarkup("__bold__"), "*bold*");
  assert.equal(toWhatsappMarkup("## Heading"), "Heading");
  assert.equal(toWhatsappMarkup("`code`"), "code");
  assert.equal(toWhatsappMarkup("- one\n- two"), "• one\n• two");
  assert.equal(toWhatsappMarkup("[Aval](https://aval.app)"), "Aval (https://aval.app)");
  // The failure this prevents: `**x**` rendering on a phone as literal asterisks.
  assert.ok(!toWhatsappMarkup("**x**").includes("**"));
});

test("evidence is capped at five rows with a count of the rest", () => {
  const answer: AskAnswer = { ...ANSWER, evidence_ids: Array.from({ length: 9 }, (_, i) => `resident:Person ${i}`) };
  const { body } = renderAnswer({ answer, locale: "en", terms: TERMS });
  const bullets = body.split("\n").filter((line) => line.startsWith("• "));
  assert.equal(bullets.length, MAX_EVIDENCE_ROWS);
  assert.ok(body.includes("and 4 more"));
});

test("the provenance prefix is stripped from evidence labels", () => {
  const { body } = renderAnswer({ answer: ANSWER, locale: "en", terms: TERMS });
  assert.ok(body.includes("• Lucía R."));
  assert.ok(!body.includes("resident:"), "an internal tag must not reach the recipient");
});

test("a long answer is capped and its remainder kept", () => {
  const answer: AskAnswer = { ...ANSWER, narrative: "sentence. ".repeat(400) };
  const { body, overflow } = renderAnswer({ answer, locale: "en", terms: TERMS });
  assert.ok(body.length <= MAX_BODY, `body was ${body.length}`);
  assert.ok(body.includes("MORE"));
  assert.ok(overflow && overflow.length > 0, "the rest must be retrievable, not discarded");
});

test("a short answer is not truncated and has no overflow", () => {
  const { body, overflow } = renderAnswer({ answer: ANSWER, locale: "en", terms: TERMS });
  assert.equal(overflow, null);
  assert.ok(!body.includes("MORE"));
});

test("truncation prefers a line boundary so a figure is never cut in half", () => {
  const text = `${"a".repeat(600)}\n${"b".repeat(600)}`;
  const { body } = truncate(text, "en");
  assert.ok(body.length <= MAX_BODY);
  // The cut landed on the newline, so the trailing content is whole `a`s.
  assert.ok(!body.includes("b"), "the second line should have been deferred whole");
});

test("every answer carries buttons — this is the discoverable surface", () => {
  const { buttons } = renderAnswer({
    answer: ANSWER,
    locale: "en",
    terms: TERMS,
    suggestions: suggestionsFor({ role: "owner", locale: "en" }),
  });
  assert.ok(buttons.length > 0, "an answer with no buttons is a dead end");
  assert.ok(buttons.length <= 3, "WhatsApp accepts at most three");
});

test("More takes a button slot when there is overflow", () => {
  const buttons = buildButtons([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], true, "en");
  assert.equal(buttons.length, 3);
  assert.equal(buttons[0].id, "more");
});

test("buttons are deduplicated by id", () => {
  const buttons = buildButtons([{ id: "a", label: "A" }, { id: "a", label: "A again" }], false, "en");
  assert.equal(buttons.length, 1);
});

test("a coordinator is not offered buttons for tools their role cannot reach", () => {
  const buttons = suggestionsFor({ role: "member", locale: "en" });
  // get_accounting_breakdown is not in the member tool set, so no ledger
  // question may be suggested — a button that leads to a refusal is worse
  // than no button.
  assert.ok(!buttons.some((b) => b.id === "ask:delinquency"));
  assert.ok(!buttons.some((b) => b.id === "ask:collections"));
});

test("an owner is offered the ledger questions", () => {
  const buttons = suggestionsFor({ role: "owner", locale: "en" });
  assert.ok(buttons.some((b) => b.id === "ask:delinquency" || b.id === "ask:collections"));
});

test("a suggestion is not repeated when the answer already used its tool", () => {
  const buttons = suggestionsFor({ role: "owner", locale: "en", toolsUsed: ["get_accounting_breakdown"] });
  assert.ok(!buttons.some((b) => b.id === "ask:delinquency"));
});

test("a button id resolves to a real question, and an unknown one to null", () => {
  assert.equal(questionForSuggestion("ask:vacancy", "en"), "Which units are vacant?");
  assert.equal(questionForSuggestion("ask:vacancy", "es-mx"), "¿Qué unidades están vacías?");
  // Untrusted input arriving as a button payload must not be acted on.
  assert.equal(questionForSuggestion("../../etc/passwd", "en"), null);
  assert.equal(questionForSuggestion("ask:nonexistent", "en"), null);
});

test("Spanish renders with no missing keys and no English leaking through", () => {
  const answer: AskAnswer = { ...ANSWER, evidence_ids: Array.from({ length: 8 }, (_, i) => `resident:P${i}`) };
  const { body } = renderAnswer({ answer, locale: "es-mx", terms: defaultTerms("es-mx") });
  assert.ok(body.includes("y 3 más"), "the overflow count must be in locale");
  assert.ok(!body.includes("and 3 more"));
});
