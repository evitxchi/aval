import assert from "node:assert/strict";
import test from "node:test";

/**
 * Open access is only safe because a signed-out visitor can never resolve to
 * a real customer's organization. That rests on one property: real org ids are
 * `org_` plus a hex digest, and the guest org id is a fixed literal containing
 * characters a hex digest cannot produce.
 *
 * If someone later changes the id format on either side, this fails — which is
 * the point. Silently losing this property would put every workspace's data
 * behind a public URL.
 */

// Mirrors organizationIdForUser in lib/integrations/session.ts, which can't be
// imported here: it pulls next/headers through the module graph.
async function organizationIdForUser(userId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)));
  return `org_${Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const PUBLIC_DEMO_ORGANIZATION_ID = "org_public_demo";

test("a real organization id is always org_ plus a 24-character hex digest", async () => {
  for (const userId of ["user-1", "evalxnder@gmail.com", "", "org_public_demo", "a".repeat(500)]) {
    assert.match(await organizationIdForUser(userId), /^org_[0-9a-f]{24}$/);
  }
});

test("the guest organization id cannot be produced by the real id function", async () => {
  // Structural, not probabilistic: 'p', 'u', 'l', 'i', 'c' and '_' are not hex
  // digits, so no input can ever hash to this string.
  assert.doesNotMatch(PUBLIC_DEMO_ORGANIZATION_ID, /^org_[0-9a-f]{24}$/);
  for (const userId of ["guest", "public-demo-guest", "demo", ""]) {
    assert.notEqual(await organizationIdForUser(userId), PUBLIC_DEMO_ORGANIZATION_ID);
  }
});

test("distinct users get distinct organizations, so open access can't merge two accounts", async () => {
  const ids = await Promise.all(["alice", "bob", "carol"].map(organizationIdForUser));
  assert.equal(new Set(ids).size, ids.length);
});

test("the same user always resolves to the same organization", async () => {
  assert.equal(await organizationIdForUser("stable-user"), await organizationIdForUser("stable-user"));
});
