import assert from "node:assert/strict";
import test from "node:test";
import { approvalMatchesToolUse } from "../lib/agents/approval-binding.ts";

test("an approval binds to one exact tool-use id", () => {
  const evidence = JSON.stringify({ toolUseId: "call_1", arguments: { amount_cents: 5000 } });
  assert.equal(approvalMatchesToolUse(evidence, { id: "call_1", name: "issue_payment" }, "issue_payment"), true);
  assert.equal(approvalMatchesToolUse(evidence, { id: "call_2", name: "issue_payment" }, "issue_payment"), false);
});

test("a matching id cannot authorize a different tool", () => {
  const evidence = JSON.stringify({ toolUseId: "call_1" });
  assert.equal(approvalMatchesToolUse(evidence, { id: "call_1", name: "issue_refund" }, "issue_payment"), false);
});

test("legacy or malformed evidence fails closed", () => {
  assert.equal(approvalMatchesToolUse("{}", { id: "call_1", name: "issue_payment" }, "issue_payment"), false);
  assert.equal(approvalMatchesToolUse("not-json", { id: "call_1", name: "issue_payment" }, "issue_payment"), false);
});
