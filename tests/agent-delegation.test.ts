import assert from "node:assert/strict";
import test from "node:test";
import { DELEGATION_RULES, checkDelegation, effectivePermissions, type DelegationParent } from "../lib/agents/delegation-rules.ts";
import { AGENT_PERMISSIONS, type AgentRole } from "../lib/agents/permissions.ts";
import { MAX_DELEGATION_DEPTH } from "../lib/agents/policy.ts";

const parent = (over: Partial<DelegationParent> = {}): DelegationParent => ({
  agentId: "financial",
  delegationDepth: 0,
  maxSteps: 12,
  stepCount: 2,
  maxTokens: 60_000,
  tokensUsed: 5_000,
  cancelRequested: false,
  ...over,
});

test("a declared pair delegates", () => {
  const check = checkDelegation(parent(), "leaseReview");
  assert.equal(check.ok, true);
});

test("an undeclared pair is refused, however sensible it sounds", () => {
  // Market Research reading leases would be useful and is still not allowed:
  // the reachable graph has to be readable from one table, not inferred.
  const check = checkDelegation(parent({ agentId: "marketResearch" }), "leaseReview");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.code, "not_allowed");
});

test("delegation stops at the depth cap", () => {
  const check = checkDelegation(parent({ delegationDepth: MAX_DELEGATION_DEPTH }), "leaseReview");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.code, "depth_exceeded");
});

test("a parent with no budget left cannot open a child", () => {
  for (const over of [{ stepCount: 11 }, { stepCount: 12 }, { tokensUsed: 60_000 }]) {
    const check = checkDelegation(parent(over), "leaseReview");
    assert.equal(check.ok, false, `${JSON.stringify(over)} should refuse`);
    assert.equal(check.ok === false && check.code, "no_budget");
  }
});

test("a cancelling parent cannot start new work under it", () => {
  const check = checkDelegation(parent({ cancelRequested: true }), "leaseReview");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.code, "cancelled");
});

test("a child never holds a permission its parent lacks", () => {
  // This is the property that stops delegation becoming the documented route
  // around a permission boundary.
  for (const [from, targets] of Object.entries(DELEGATION_RULES) as [AgentRole, readonly AgentRole[]][]) {
    const parentPermissions = new Set(AGENT_PERMISSIONS[from]);
    for (const to of targets) {
      for (const permission of effectivePermissions(from, to)) {
        assert.ok(parentPermissions.has(permission), `${from} → ${to} would grant "${permission}" the parent does not hold`);
      }
    }
  }
});

test("the intersection is a real narrowing where the envelopes differ", () => {
  // Lease Review holds documents.read; Financial does not, so a Financial →
  // Lease Review child cannot read documents either. The delegation is still
  // useful for the leases.read overlap, and that limit is the point.
  const effective = effectivePermissions("financial", "leaseReview");
  assert.equal(effective.includes("documents.read"), false);
  assert.equal(effective.includes("leases.read"), true);
});

test("no delegation rule points at an agent that does not exist", () => {
  for (const [from, targets] of Object.entries(DELEGATION_RULES) as [AgentRole, readonly AgentRole[]][]) {
    assert.ok(AGENT_PERMISSIONS[from], `unknown delegator "${from}"`);
    for (const to of targets) {
      assert.ok(AGENT_PERMISSIONS[to], `unknown delegate "${to}"`);
      assert.notEqual(from, to, `"${from}" delegates to itself`);
    }
  }
});

test("the delegation graph has no cycle within the depth cap", () => {
  // A cycle would not run forever — the depth cap stops it — but it would burn
  // the whole budget going nowhere, so it is worth refusing by construction.
  const seen: string[] = [];
  const walk = (role: AgentRole, path: AgentRole[]) => {
    if (path.length > MAX_DELEGATION_DEPTH + 1) return;
    for (const next of DELEGATION_RULES[role] ?? []) {
      if (path.includes(next)) seen.push([...path, next].join(" → "));
      else walk(next, [...path, next]);
    }
  };
  for (const role of Object.keys(DELEGATION_RULES) as AgentRole[]) walk(role, [role]);
  assert.deepEqual(seen, [], `delegation cycles: ${seen.join("; ")}`);
});
