import assert from "node:assert/strict";
import test from "node:test";
import {
  canApprove,
  canInvite,
  canManageMembers,
  canManagePolicy,
  isWorkspaceRole,
  removalRefusal,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "../lib/organizations/roles.ts";

/**
 * The workspace roles, which exist for one reason: until they did,
 * `organizationIdForUser` hashed a user id into a workspace, so every account
 * was alone in its own. The elevated approval tier needs two distinct
 * approvers and separation of duties forbids a requester approving their own
 * critical action — both were unsatisfiable, so every payment over the
 * single-approval ceiling was permanently unapprovable.
 */

test("reading the portfolio and releasing money are different permissions", () => {
  // The whole reason to have roles rather than a member/non-member flag.
  assert.equal(canApprove("member"), false);
  assert.equal(canApprove("approver"), true);
  assert.equal(canApprove("owner"), true);
});

test("only the owner administers the workspace", () => {
  for (const role of ["member", "approver"] as WorkspaceRole[]) {
    assert.equal(canInvite(role), false, role);
    assert.equal(canManagePolicy(role), false, role);
    assert.equal(canManageMembers(role), false, role);
  }
  assert.equal(canInvite("owner"), true);
  assert.equal(canManagePolicy("owner"), true);
  assert.equal(canManageMembers("owner"), true);
});

test("an approver cannot promote themselves by inviting", () => {
  // Approval authority and the ability to hand it out are deliberately split:
  // otherwise one compromised approver can manufacture the second one that
  // the elevated tier requires.
  assert.equal(canApprove("approver"), true);
  assert.equal(canInvite("approver"), false);
});

test("every declared role has a defined answer for every permission", () => {
  for (const role of WORKSPACE_ROLES) {
    for (const check of [canApprove, canInvite, canManagePolicy, canManageMembers]) {
      assert.equal(typeof check(role), "boolean", `${check.name}(${role})`);
    }
  }
});

test("an unrecognized role is not a role", () => {
  for (const value of ["admin", "Owner", "", null, undefined, 1, {}]) {
    assert.equal(isWorkspaceRole(value), false, JSON.stringify(value));
  }
  for (const role of WORKSPACE_ROLES) assert.equal(isWorkspaceRole(role), true, role);
});

/* ── removal ─────────────────────────────────────────────────────────────── */

test("a non-owner cannot remove anyone", () => {
  assert.equal(removalRefusal("approver", "member", "user_2", "user_3"), "not_permitted");
  assert.equal(removalRefusal("member", "member", "user_3", "user_4"), "not_permitted");
});

test("the owner cannot be removed, so a workspace is never left unadministered", () => {
  assert.equal(removalRefusal("owner", "owner", "user_1", "user_9"), "cannot_remove_owner");
});

test("an owner cannot remove themselves", () => {
  // The same mistake by another route: owner is the only role that can invite
  // or set policy, so this would strand the workspace just as surely.
  assert.equal(removalRefusal("owner", "owner", "user_1", "user_1"), "cannot_remove_owner");
  assert.equal(removalRefusal("owner", "approver", "user_1", "user_1"), "cannot_remove_self");
});

test("an owner may remove an approver or a member", () => {
  assert.equal(removalRefusal("owner", "approver", "user_1", "user_2"), null);
  assert.equal(removalRefusal("owner", "member", "user_1", "user_3"), null);
});

test("permission is checked before anything about the target", () => {
  // A member attempting to remove the owner is told they lack permission,
  // rather than learning the owner is protected — the refusal that always
  // applies is the one to report.
  assert.equal(removalRefusal("member", "owner", "user_3", "user_1"), "not_permitted");
});
