import assert from "node:assert/strict";
import test from "node:test";
import { canDecide, type DecidableApproval } from "../lib/agents/approval-rules.ts";
import { APPROVAL_TTL_MS } from "../lib/agents/approvals-ttl.ts";

const NOW = new Date("2026-09-04T12:00:00Z");
const pending = (over: Partial<DecidableApproval> = {}): DecidableApproval => ({
  status: "pending",
  riskLevel: "critical",
  expiresAt: new Date(NOW.getTime() + 60_000),
  ...over,
});

test("a member cannot decide an approval at all", () => {
  // The role is what makes the elevated tier real: inviting a colleague to
  // read the portfolio must not hand them the ability to release money.
  const outcome = canDecide(pending(), "approved", "user_2", "user_1", "member", NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "not_an_approver");
});

test("a member cannot reject either, so authority is one question not two", () => {
  const outcome = canDecide(pending(), "rejected", "user_2", "user_1", "member", NOW);
  assert.equal(outcome.ok === false && outcome.reason, "not_an_approver");
});

test("an owner may approve", () => {
  assert.deepEqual(canDecide(pending(), "approved", "user_2", "user_1", "owner", NOW), { ok: true });
});

test("authority is checked before anything about the request", () => {
  // Someone with no standing learns that, rather than learning which action
  // was proposed or when it expires.
  const outcome = canDecide(pending({ status: "approved", expiresAt: new Date(NOW.getTime() - 1) }), "approved", "user_1", "user_1", "member", NOW);
  assert.equal(outcome.ok === false && outcome.reason, "not_an_approver");
});

test("an approver who is not the requester may approve a critical action", () => {
  assert.deepEqual(canDecide(pending(), "approved", "user_2", "user_1", "approver", NOW), { ok: true });
});

test("the person whose task proposed a critical action cannot approve it", () => {
  // Separation of duties. Without this the human gate is decorative: the same
  // person proposes the payment and clears it.
  const outcome = canDecide(pending(), "approved", "user_1", "user_1", "approver", NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "self_approval");
});

test("the requester may always reject their own proposal", () => {
  // Deliberately asymmetric: a gate that is hard to open and easy to close
  // fails in the safe direction.
  assert.deepEqual(canDecide(pending(), "rejected", "user_1", "user_1", "approver", NOW), { ok: true });
});

test("self-approval is only restricted for critical actions", () => {
  for (const riskLevel of ["low", "medium", "high"]) {
    assert.deepEqual(canDecide(pending({ riskLevel }), "approved", "user_1", "user_1", "approver", NOW), { ok: true }, riskLevel);
  }
});

test("a settled approval cannot be decided again", () => {
  for (const status of ["approved", "rejected", "expired"] as const) {
    const outcome = canDecide(pending({ status }), "approved", "user_2", "user_1", "approver", NOW);
    assert.equal(outcome.ok, false, status);
    assert.equal(outcome.ok === false && outcome.reason, "already_decided");
  }
});

test("an expired request is refused whether or not a sweep has run", () => {
  const expired = pending({ expiresAt: new Date(NOW.getTime() - 1) });
  const outcome = canDecide(expired, "approved", "user_2", "user_1", "approver", NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "expired");
  // Status still reads "pending" — the clock decides, not the sweep.
  assert.equal(expired.status, "pending");
});

test("expiry is checked at the boundary, not approximately", () => {
  assert.equal(canDecide(pending({ expiresAt: NOW }), "approved", "user_2", "user_1", "approver", NOW).ok, true);
  assert.equal(canDecide(pending({ expiresAt: new Date(NOW.getTime() - 1) }), "approved", "user_2", "user_1", "approver", NOW).ok, false);
});

test("expiry is checked before separation of duties", () => {
  // An expired self-approval is refused for being expired: the more absolute
  // reason should be the one reported, so re-proposing is the obvious fix.
  const outcome = canDecide(pending({ expiresAt: new Date(NOW.getTime() - 1) }), "approved", "user_1", "user_1", "approver", NOW);
  assert.equal(outcome.ok === false && outcome.reason, "expired");
});

test("the request window is long enough to survive one night away from a desk", () => {
  assert.ok(APPROVAL_TTL_MS >= 12 * 60 * 60 * 1000 && APPROVAL_TTL_MS <= 7 * 24 * 60 * 60 * 1000);
});
