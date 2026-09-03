import assert from "node:assert/strict";
import test from "node:test";
import { PREFERENCE_TOPICS, describePreference, listPreferenceOptions } from "../lib/ask-aval/preference-taxonomy.ts";

// Taught preferences are read back into every Ask Aval system prompt
// (getPreferenceContext), so the Setup view's picker must offer exactly the
// taxonomy the assistant can actually act on — no more, no less.

test("the Setup picker offers every topic and statement the taxonomy allows, and nothing else", () => {
  const options = listPreferenceOptions();
  assert.deepEqual(options.map((o) => o.topic).sort(), Object.keys(PREFERENCE_TOPICS).sort());
  for (const option of options) {
    const allowed = PREFERENCE_TOPICS[option.topic];
    assert.deepEqual(option.statements.map((s) => s.statement), [...allowed]);
  }
});

test("every offered statement has a real human label, not a raw tag fallback", () => {
  for (const option of listPreferenceOptions()) {
    for (const choice of option.statements) {
      assert.equal(choice.label, describePreference(option.topic, choice.statement));
      assert.equal(choice.label.includes(choice.statement), false, `"${choice.statement}" fell back to its raw tag`);
      assert.equal(choice.label.endsWith("."), true, `"${choice.statement}" should read as a sentence`);
    }
  }
});

test("no stored statement can carry workspace-specific business content", () => {
  // The privacy guarantee is structural: statements are fixed identifiers, so
  // a tenant name, address or amount cannot be written into memory even by a
  // malformed client. Guard the shape that makes that true.
  for (const [topic, statements] of Object.entries(PREFERENCE_TOPICS)) {
    for (const statement of statements) {
      assert.match(statement, /^[a-z0-9_]+$/, `"${topic}/${statement}" must stay a fixed snake_case tag`);
    }
  }
});
