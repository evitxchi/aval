import assert from "node:assert/strict";
import test from "node:test";
import { MIN_CONFIDENCE, TEACHING_SUGGESTIONS, matchPreference } from "../lib/ask-aval/preference-matching.ts";
import { PREFERENCE_TOPICS, type PreferenceTopic } from "../lib/ask-aval/preference-taxonomy.ts";

// The typed teaching box classifies free text into a fixed tag and stores
// only the tag. These tests pin that the classification is actually right —
// a confident wrong guess about how someone wants their money spent is worse
// than asking, so both halves matter: correct matches, and no match at all
// when the text doesn't mean anything in this taxonomy.

const CASES: [string, PreferenceTopic, string][] = [
  ["always get me three quotes before booking a plumber", "vendor_selection", "always_compare_multiple_quotes"],
  ["go with whoever can get there soonest", "vendor_selection", "prefer_fastest_available_vendor"],
  ["pick the cheapest contractor", "vendor_selection", "prefer_lowest_cost_vendor"],
  ["message tenants on whatsapp", "communication_channel", "prefer_whatsapp_for_tenants"],
  ["email tenants instead", "communication_channel", "prefer_email_for_tenants"],
  ["call me for emergencies", "communication_channel", "prefer_phone_for_urgent_issues"],
  ["keep summaries short", "reporting_style", "keep_summaries_brief"],
  ["i want the full line item breakdown", "reporting_style", "include_full_breakdowns"],
  ["ask me before spending over 500", "approval_threshold", "always_ask_before_spend_over_500"],
  ["auto approve the small routine stuff", "approval_threshold", "auto_approve_under_200"],
];

for (const [text, topic, statement] of CASES) {
  test(`"${text}" classifies to ${topic}/${statement}`, () => {
    const match = matchPreference(text);
    assert.ok(match, "expected a match");
    assert.equal(match.topic, topic);
    assert.equal(match.statement, statement);
    assert.ok(match.confidence >= MIN_CONFIDENCE);
  });
}

test("text with no meaning in this taxonomy returns no match rather than a wrong guess", () => {
  for (const text of ["hello there", "the quick brown fox", "", "   ", "!!!"]) {
    assert.equal(matchPreference(text), null, `"${text}" should not match anything`);
  }
});

test("every statement's own canonical label classifies back to itself", () => {
  // A round-trip: if the label a user is shown doesn't match its own tag, the
  // vocabulary is wrong somewhere.
  for (const topic of Object.keys(PREFERENCE_TOPICS) as PreferenceTopic[]) {
    for (const statement of PREFERENCE_TOPICS[topic]) {
      const index = (PREFERENCE_TOPICS[topic] as readonly string[]).indexOf(statement);
      const match = matchPreference(TEACHING_SUGGESTIONS[topic][index]);
      assert.ok(match, `suggestion for ${statement} matched nothing`);
      assert.equal(match.statement, statement, `suggestion for ${statement} classified as ${match.statement}`);
    }
  }
});

test("every topic offers one suggestion per statement, in the same order", () => {
  for (const topic of Object.keys(PREFERENCE_TOPICS) as PreferenceTopic[]) {
    assert.equal(TEACHING_SUGGESTIONS[topic].length, PREFERENCE_TOPICS[topic].length);
  }
});

test("padding a sentence with unrelated words lowers confidence rather than raising it", () => {
  const tight = matchPreference("keep summaries brief");
  const padded = matchPreference("keep summaries brief although honestly whatever works for the wider portfolio team");
  assert.ok(tight && padded);
  assert.ok(tight.confidence > padded.confidence);
});
