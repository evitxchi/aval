import assert from "node:assert/strict";
import test from "node:test";
import { InvalidPersonaInputError, validateCustomPersonaInput, MAX_LABEL_CHARS, MAX_FOCUS_CHARS } from "../lib/ask-aval/persona-validation.ts";

const baseInput = { label: "Vendor Coordinator", focusDescription: "Coordinate vendor dispatch for open work orders.", toolNames: null, shape: "monolith", theme: "aqua" };

test("validateCustomPersonaInput accepts a well-formed input and trims whitespace", () => {
  const result = validateCustomPersonaInput({ ...baseInput, label: "  Vendor Coordinator  " });
  assert.equal(result.label, "Vendor Coordinator");
  assert.equal(result.shape, "monolith");
  assert.equal(result.theme, "aqua");
  assert.equal(result.toolNames, null);
});

test("validateCustomPersonaInput rejects an empty label", () => {
  assert.throws(() => validateCustomPersonaInput({ ...baseInput, label: "   " }), InvalidPersonaInputError);
});

test("validateCustomPersonaInput rejects an empty focus description", () => {
  assert.throws(() => validateCustomPersonaInput({ ...baseInput, focusDescription: "" }), InvalidPersonaInputError);
});

test("validateCustomPersonaInput truncates an over-long label and focus description rather than rejecting them", () => {
  const result = validateCustomPersonaInput({ ...baseInput, label: "x".repeat(200), focusDescription: "y".repeat(2000) });
  assert.equal(result.label.length, MAX_LABEL_CHARS);
  assert.equal(result.focusDescription.length, MAX_FOCUS_CHARS);
});

test("validateCustomPersonaInput rejects an unrecognized shape", () => {
  assert.throws(() => validateCustomPersonaInput({ ...baseInput, shape: "circle" }), InvalidPersonaInputError);
});

test("validateCustomPersonaInput rejects an unrecognized theme", () => {
  assert.throws(() => validateCustomPersonaInput({ ...baseInput, theme: "rainbow" }), InvalidPersonaInputError);
});

test("validateCustomPersonaInput filters toolNames down to recognized tools only", () => {
  const result = validateCustomPersonaInput({ ...baseInput, toolNames: ["get_portfolio_metrics", "delete_everything", "get_leasing_funnel"] });
  assert.deepEqual(result.toolNames, ["get_portfolio_metrics", "get_leasing_funnel"]);
});

test("validateCustomPersonaInput rejects toolNames that contains only unrecognized tools", () => {
  assert.throws(() => validateCustomPersonaInput({ ...baseInput, toolNames: ["delete_everything"] }), InvalidPersonaInputError);
});
