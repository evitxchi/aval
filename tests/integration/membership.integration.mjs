import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";

/**
 * Workspace membership, executed against real storage.
 *
 * Multi-workspace membership introduces the one thing the Level 4 audit found
 * no instance of: a way for a request to name a workspace. The session cookie
 * carries that name for thirty days, which is longer than a membership is
 * guaranteed to last, so the tests that matter most here are the ones where
 * the claim is stale, revoked, or simply false.
 */

const NOW = Date.now();

async function setup() {
  const sqlite = await bootRuntime();
  const membership = await import("../../lib/organizations/membership.ts");
  const user = (id, email) =>
    sqlite.prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, email, "hash", email.split("@")[0], NOW, NOW);
  const org = (id, owner, name) =>
    sqlite.prepare("INSERT INTO organizations (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(id, name, owner, NOW, NOW);
  // org_1 already exists from the harness, owned by user_1.
  user("user_1", "owner@example.com");
  user("user_2", "approver@example.com");
  user("user_3", "member@example.com");
  user("user_9", "outsider@example.com");
  org("org_personal_9", "user_9", "Outsider's own workspace");
  return { sqlite, membership };
}

test("an owner holds their workspace without needing a membership row", async () => {
  const { membership } = await setup();
  // Every workspace predates this table and records its owner on itself. A
  // missing row must not lock an owner out of their own data.
  assert.equal(await membership.roleFor("user_1", "org_1"), "owner");
});

test("someone with no membership holds no role", async () => {
  const { membership } = await setup();
  assert.equal(await membership.roleFor("user_9", "org_1"), null);
});

test("a session naming a workspace the user does not belong to falls back to their own", async () => {
  const { membership } = await setup();
  const resolved = await membership.resolveMembership("user_9", "org_personal_9", "org_1");
  assert.equal(resolved.organizationId, "org_personal_9", "a false claim must not reach another tenant");
  assert.equal(resolved.role, "owner");
});

test("a revoked member's live session stops reaching the workspace on the next request", async () => {
  const { membership } = await setup();
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_3", role: "member" });
  assert.equal((await membership.resolveMembership("user_3", "org_personal_3", "org_1")).organizationId, "org_1");

  // The cookie is unchanged and still names org_1 — only the row is gone.
  await membership.removeMembership("org_1", "user_3");
  const after = await membership.resolveMembership("user_3", "org_personal_3", "org_1");
  assert.equal(after.organizationId, "org_personal_3", "access must end with the membership, not with the cookie");
  assert.equal(after.role, "owner");
});

test("a member resolves to the role they were granted, not the one they ask for", async () => {
  const { membership } = await setup();
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_2", role: "approver" });
  const resolved = await membership.resolveMembership("user_2", "org_personal_2", "org_1");
  assert.equal(resolved.organizationId, "org_1");
  assert.equal(resolved.role, "approver");
});

test("no claim at all resolves to the personal workspace", async () => {
  const { membership } = await setup();
  const resolved = await membership.resolveMembership("user_9", "org_personal_9", undefined);
  assert.equal(resolved.organizationId, "org_personal_9");
});

test("a role change takes effect without creating a second membership", async () => {
  const { sqlite, membership } = await setup();
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_3", role: "member" });
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_3", role: "approver" });
  const rows = sqlite.prepare("SELECT COUNT(*) c FROM organization_members WHERE organization_id='org_1' AND user_id='user_3'").get().c;
  assert.equal(rows, 1, "the unique index is what makes two distinct approvers countable");
  assert.equal(await membership.roleFor("user_3", "org_1"), "approver");
});

/* ── invitations ─────────────────────────────────────────────────────────── */

test("an invitation code is stored only as a hash", async () => {
  const { sqlite, membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "approver", createdByUserId: "user_1" });
  const row = sqlite.prepare("SELECT * FROM organization_invitations WHERE id=?").get(invitation.id);
  assert.ok(invitation.code.startsWith("AVAL-"));
  assert.ok(!JSON.stringify(row).includes(invitation.code), "a code readable from the row is one a database read can steal");
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
});

test("accepting an invitation grants exactly the role it was issued for", async () => {
  const { membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "approver", createdByUserId: "user_1" });
  const accepted = await membership.acceptInvitation(invitation.code, "user_2");
  assert.equal(accepted.ok, true);
  assert.equal(accepted.organizationId, "org_1");
  assert.equal(await membership.roleFor("user_2", "org_1"), "approver");
});

test("one code cannot be redeemed twice", async () => {
  const { membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "member", createdByUserId: "user_1" });
  assert.equal((await membership.acceptInvitation(invitation.code, "user_2")).ok, true);
  const second = await membership.acceptInvitation(invitation.code, "user_3");
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_accepted");
  assert.equal(await membership.roleFor("user_3", "org_1"), null, "the loser of the race gets no access");
});

test("an expired invitation is refused", async () => {
  const { sqlite, membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "member", createdByUserId: "user_1" });
  sqlite.prepare("UPDATE organization_invitations SET expires_at=? WHERE id=?").run(Date.now() - 1000, invitation.id);
  const outcome = await membership.acceptInvitation(invitation.code, "user_2");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "expired");
});

test("a revoked invitation is refused", async () => {
  const { membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "member", createdByUserId: "user_1" });
  assert.equal(await membership.revokeInvitation("org_1", invitation.id), true);
  const outcome = await membership.acceptInvitation(invitation.code, "user_2");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "revoked");
});

test("a workspace cannot revoke another workspace's invitation", async () => {
  const { membership } = await setup();
  const invitation = await membership.issueInvitation({ organizationId: "org_1", role: "member", createdByUserId: "user_1" });
  assert.equal(await membership.revokeInvitation("org_personal_9", invitation.id), false);
  assert.equal((await membership.acceptInvitation(invitation.code, "user_2")).ok, true, "the invitation must still be live");
});

test("an unknown code is refused the same way a wrong one is", async () => {
  const { membership } = await setup();
  // Distinguishing them would turn this into an oracle for guessing codes.
  const outcome = await membership.acceptInvitation("AVAL-00000-00000-00000-00000", "user_2");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "not_found");
});

/* ── the control this whole feature exists to make real ──────────────────── */

test("a workspace can now hold two distinct approvers", async () => {
  const { membership } = await setup();
  assert.equal(await membership.approverCount("org_1"), 1, "an owner alone is one approver");

  await membership.upsertMembership({ organizationId: "org_1", userId: "user_2", role: "approver" });
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_3", role: "member" });

  // The elevated tier requires two distinct approvers. Before membership
  // existed this count could never exceed one, so every payment above the
  // single-approval ceiling was permanently unapprovable.
  assert.equal(await membership.approverCount("org_1"), 2);

  const members = await membership.listMembers("org_1");
  assert.equal(members.length, 3);
  assert.equal(members[0].isOwner, true, "the owner is listed first");
  assert.deepEqual(members.map((m) => m.role).sort(), ["approver", "member", "owner"]);
});

test("a member does not count toward the approver requirement", async () => {
  const { membership } = await setup();
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_2", role: "member" });
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_3", role: "member" });
  assert.equal(await membership.approverCount("org_1"), 1, "three people, still one approver");
});

test("the switcher lists every workspace a user can act in, and no others", async () => {
  const { membership } = await setup();
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_9", role: "member" });
  const workspaces = await membership.listWorkspacesForUser("user_9", "org_personal_9");
  assert.deepEqual(workspaces.map((w) => w.organizationId).sort(), ["org_1", "org_personal_9"]);
  assert.equal(workspaces.find((w) => w.isPersonal).organizationId, "org_personal_9");
  assert.equal(workspaces.find((w) => w.organizationId === "org_1").role, "member");
});

test("an elevated action needs two distinct approvers, and can now get them", async () => {
  const { membership } = await setup();
  const approvals = await import("../../lib/agents/approvals.ts");
  const registry = await import("../../lib/agents/registry.ts");
  const tasks = await import("../../lib/agents/tasks.ts");

  await membership.upsertMembership({ organizationId: "org_1", userId: "user_2", role: "approver" });
  await membership.upsertMembership({ organizationId: "org_1", userId: "user_9", role: "approver" });

  const task = await tasks.createTask({ organizationId: "org_1", userId: "user_1", agentId: "financial", goal: "Pay the vendor" });
  const approval = await approvals.requestApproval({
    taskId: task.id, organizationId: "org_1", stepIndex: 0,
    tool: registry.getTool("issue_payment"), evidence: { toolUseId: "tu_1", args: {} },
    amountCents: 60_000, currency: "USD",
  });

  // requiredApprovals was read from the caller's optional tier hint rather
  // than the tier the request actually carries, so an amount-derived
  // elevated_approver was stamped as needing one approver — one person could
  // clear a two-person action. Unreachable until a workspace could hold two
  // people, which is precisely when it would have mattered.
  assert.equal(approval.tier, "elevated_approver");
  assert.equal(approval.requiredApprovals, 2);

  const first = await approvals.decideApproval("org_1", approval.id, "approved", "user_2", "user_1", "approver", "one");
  assert.equal(first.ok, true);
  assert.equal(first.complete, false, "one approval does not release an elevated action");

  const repeat = await approvals.decideApproval("org_1", approval.id, "approved", "user_2", "user_1", "approver", "again");
  assert.equal(repeat.ok, false);
  assert.equal(repeat.reason, "duplicate_approver", "the same person twice is one decision, not two");

  const second = await approvals.decideApproval("org_1", approval.id, "approved", "user_9", "user_1", "approver", "two");
  assert.equal(second.ok, true);
  assert.equal(second.complete, true, "two distinct approvers release it");
});

test("the requester cannot be one of the two approvers on a critical action", async () => {
  const { membership } = await setup();
  const approvals = await import("../../lib/agents/approvals.ts");
  const registry = await import("../../lib/agents/registry.ts");
  const tasks = await import("../../lib/agents/tasks.ts");

  await membership.upsertMembership({ organizationId: "org_1", userId: "user_2", role: "approver" });
  const task = await tasks.createTask({ organizationId: "org_1", userId: "user_1", agentId: "financial", goal: "Pay" });
  const approval = await approvals.requestApproval({
    taskId: task.id, organizationId: "org_1", stepIndex: 0,
    tool: registry.getTool("issue_payment"), evidence: { toolUseId: "tu_2", args: {} },
    amountCents: 60_000, currency: "USD",
  });

  await approvals.decideApproval("org_1", approval.id, "approved", "user_2", "user_1", "approver", "one");
  // user_1 owns the task. Being the owner of the workspace does not exempt
  // them from separation of duties on the action they proposed.
  const byRequester = await approvals.decideApproval("org_1", approval.id, "approved", "user_1", "user_1", "owner", "mine");
  assert.equal(byRequester.ok, false);
  assert.equal(byRequester.reason, "self_approval");
});
