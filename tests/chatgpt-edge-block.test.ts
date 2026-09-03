import assert from "node:assert/strict";
import test from "node:test";
import { isHostedEdgeChallenge } from "../lib/integrations/provider-errors.ts";

const challengeBody = `<!doctype html><html><style>
body{font-family:Arial,Helvetica,sans-serif}
@keyframes enlarge-appear{0%{opacity:0}}
</style><body>Just a moment...</body></html>`;

test("identifies the HTML 403 returned by OpenAI's edge challenge", () => {
  assert.equal(isHostedEdgeChallenge(403, challengeBody), true);
  // The text exposed by model discovery has HTML tags removed but retains the
  // challenge stylesheet; it must classify the same way.
  assert.equal(isHostedEdgeChallenge(403, "403: body{font-family:Arial}@keyframes enlarge-appear{}"), true);
});

test("does not confuse normal provider failures with the hosted edge challenge", () => {
  assert.equal(isHostedEdgeChallenge(403, JSON.stringify({ error: { message: "Access token expired" } })), false);
  assert.equal(isHostedEdgeChallenge(500, challengeBody), false);
  assert.equal(isHostedEdgeChallenge(503, "<html><body>Maintenance</body></html>"), false);
});
