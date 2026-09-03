import assert from "node:assert/strict";
import test from "node:test";
import {
  GENESIS_HASH,
  chainEntry,
  chainEvents,
  digestPayload,
  serializeEntry,
  verifyChain,
  type AuditEntry,
  type AuditEvent,
} from "../lib/audit/chain.ts";

// The chain's only purpose is to make tampering detectable. A chain that
// silently accepts an edited, reordered or deleted entry is worse than no
// chain at all, because it invites trust it hasn't earned — so every one of
// those three attacks gets an explicit test.

async function sampleEvents(): Promise<AuditEvent[]> {
  return [
    { kind: "tool_call", label: "get_portfolio_metrics", payloadDigest: await digestPayload({ noi: 12345 }), count: 4 },
    { kind: "tool_call", label: "get_delinquent_accounts", payloadDigest: await digestPayload({ rows: 3 }), count: 3 },
    { kind: "verdict", label: "pass", payloadDigest: await digestPayload({ unsupported: [] }), count: 0 },
    { kind: "answer", label: "", payloadDigest: await digestPayload({ headline: "NOI is up" }), count: 0 },
  ];
}

test("a freshly built chain verifies, and its head is the last entry's hash", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  const verdict = await verifyChain(entries);
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.equal(verdict.length, 4);
  assert.equal(verdict.head, entries[3].entryHash);
});

test("the first entry commits to the genesis anchor", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  assert.equal(entries[0].previousHash, GENESIS_HASH);
  assert.equal(entries[0].sequence, 1);
});

test("each entry commits to the one before it", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  for (let index = 1; index < entries.length; index += 1) {
    assert.equal(entries[index].previousHash, entries[index - 1].entryHash);
    assert.equal(entries[index].sequence, entries[index - 1].sequence + 1);
  }
});

test("editing an entry's content is detected as a hash mismatch", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  // Someone rewrites which tool ran, leaving the recorded hash in place.
  const tampered: AuditEntry[] = entries.map((entry, index) =>
    index === 1 ? { ...entry, label: "get_leasing_funnel" } : entry);
  const verdict = await verifyChain(tampered);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "hash_mismatch");
  assert.equal(verdict.brokenAt, 2);
});

test("changing a recorded count is detected, not just a changed label", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  // A failed gate rewritten to look like it passed nothing unsupported.
  const tampered = entries.map((entry) => (entry.kind === "verdict" ? { ...entry, count: 99 } : entry));
  const verdict = await verifyChain(tampered);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "hash_mismatch");
});

test("deleting an entry is detected as a sequence gap", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  const tampered = [entries[0], entries[2], entries[3]];
  const verdict = await verifyChain(tampered);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "sequence_gap");
  assert.equal(verdict.brokenAt, 3);
});

test("reordering entries is detected", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  const tampered = [entries[0], entries[2], entries[1], entries[3]];
  const verdict = await verifyChain(tampered);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  // A swap trips the sequence check first, which is the earliest signal.
  assert.equal(verdict.reason, "sequence_gap");
});

test("substituting a whole entry from another chain is detected as a link mismatch", async () => {
  const entries = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  // A well-formed entry with the right sequence, but built on a different
  // predecessor — the shape of an attacker splicing in a legitimate-looking
  // record from elsewhere.
  const foreign = await chainEntry(
    { kind: "tool_call", label: "get_portfolio_metrics", payloadDigest: await digestPayload({ noi: 999 }), count: 1 },
    2,
    "f".repeat(64),
  );
  const verdict = await verifyChain([entries[0], foreign, entries[2], entries[3]]);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "link_mismatch");
  assert.equal(verdict.brokenAt, 2);
});

test("an empty chain verifies and reports the genesis anchor as its head", async () => {
  const verdict = await verifyChain([]);
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.equal(verdict.length, 0);
  assert.equal(verdict.head, GENESIS_HASH);
});

test("appending to an existing chain continues it rather than starting over", async () => {
  const first = await chainEvents(await sampleEvents(), 1, GENESIS_HASH);
  const head = first[first.length - 1].entryHash;
  const second = await chainEvents(
    [{ kind: "tool_call", label: "get_metric_series", payloadDigest: await digestPayload({ points: 6 }), count: 6 }],
    first.length + 1,
    head,
  );
  const verdict = await verifyChain([...first, ...second]);
  assert.equal(verdict.ok, true);
});

test("two different entries can never serialize to the same committed string", async () => {
  // Field values are separated by a unit separator precisely so a value
  // containing the separator can't forge a boundary. If a tool name could
  // contain it, these two distinct entries would collide.
  const a = { sequence: 1, previousHash: GENESIS_HASH, kind: "tool_call" as const, label: "a", payloadDigest: "d", count: 12 };
  const b = { sequence: 1, previousHash: GENESIS_HASH, kind: "tool_call" as const, label: "ad", payloadDigest: "", count: 12 };
  // b is only constructible by a caller smuggling the separator into a label;
  // the serializations must still differ.
  assert.notEqual(serializeEntry(a), serializeEntry(b));
});

test("digests are stable for the same payload and differ for different payloads", async () => {
  assert.equal(await digestPayload({ a: 1 }), await digestPayload({ a: 1 }));
  assert.notEqual(await digestPayload({ a: 1 }), await digestPayload({ a: 2 }));
  // A digest is 64 hex chars and never the payload itself.
  const digest = await digestPayload({ resident: "Jane Doe", balance: 1234 });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes("Jane"), false);
});
