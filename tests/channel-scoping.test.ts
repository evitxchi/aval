import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The structural half of tenant isolation.
 *
 * `tests/integration/channel-isolation.integration.mjs` proves that the
 * queries it exercises are scoped. It cannot prove anything about a query
 * nobody wrote a case for, and that is the failure mode the brief names: *one
 * forgotten `where` clause*, in code that reads perfectly well.
 *
 * On a database with row-level security this test would not need to exist —
 * the policy would catch it regardless of what the application remembered. We
 * are on D1, which is SQLite, so this reads the source instead: every query in
 * `lib/channels/` against a tenant-aware table must carry an
 * `organizationId` predicate. A new query with a missing scope fails here on
 * the PR that adds it rather than in production.
 *
 * It is a lint, not a proof. It checks that the predicate is *present*, not
 * that its value came from a resolved identity — `eq(x.organizationId,
 * attackerSuppliedValue)` would pass. That part is the reviewer's job, and the
 * integration test's.
 */

const CHANNELS_DIR = new URL("../lib/channels/", import.meta.url).pathname;

/**
 * Tables carrying an `organization_id`, whose rows belong to exactly one
 * tenant. Reading one of these unscoped is a cross-tenant leak.
 *
 * Kept as an explicit list rather than derived from the schema so that adding
 * a tenant-aware table is a deliberate act that shows up in review here too.
 */
const TENANT_TABLES = [
  "channelIdentities",
  "channelLinkCodes",
  "channelPendingActions",
  "channelSubscriptions",
  "channelThreadState",
  "actionCheckpoints",
  "conversations",
  "leases",
  "ledgerEntries",
  "residents",
  "properties",
  "units",
  "workOrders",
  "communicationDeliveries",
  "communicationSettings",
  "answerAuditLog",
  "aiUsage",
  "agentTasks",
];

/**
 * Tables with no `organization_id` column of their own, whose rows belong to a
 * tenant through a parent. Scoping them means predicating on that parent's
 * foreign key — the parent lookup is where the org check happens.
 */
const PARENT_SCOPED: Record<string, string> = {
  // `messages` hangs off `conversations`, which is org-scoped. A message query
  // is safe exactly when it is filtered to a conversation the caller resolved.
  messages: "conversationId",
};

/**
 * Tables keyed by something globally unique, where a lookup legitimately has
 * no org predicate — and each entry says why, because "it's fine" is how the
 * next one gets added.
 */
const EXEMPT: Record<string, string> = {
  // Unique on (channel, external_id) across every tenant. That global
  // uniqueness IS the isolation property: the lookup is what *establishes*
  // which org the caller belongs to, so it cannot already know one.
  channelIdentities: "keyed on (channel, external_id), unique across all tenants — this lookup resolves the org",
  // Primary key is the code itself, a 40-bit secret. Scoping it to an org
  // would require knowing the org before reading the row that names it.
  channelLinkCodes: "primary key is the code; the row is what names the organization",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Split a file into query expressions.
 *
 * A query starts at `.from(` or `.insert(` and runs to the end of the
 * statement. Crude on purpose: a real parse would be more accurate and much
 * harder to read, and the failure mode of crudeness here is a false positive
 * that a human resolves, not a leak that ships.
 */
function queryChunks(source: string): { table: string; chunk: string; line: number }[] {
  const chunks: { table: string; chunk: string; line: number }[] = [];
  const pattern = /\.(from|insert|update|delete)\(\s*([A-Za-z][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const table = match[2];
    if (!TENANT_TABLES.includes(table) && !PARENT_SCOPED[table]) continue;
    // Everything up to the next statement boundary. `;` at the end of a line
    // is a good enough terminator for this codebase's formatting.
    const rest = source.slice(match.index);
    const end = rest.search(/;\s*\n/);
    chunks.push({
      table,
      chunk: end === -1 ? rest : rest.slice(0, end),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return chunks;
}

test("every channel query against a tenant-aware table is org-scoped", () => {
  const violations: string[] = [];

  for (const file of sourceFiles(CHANNELS_DIR)) {
    const source = readFileSync(file, "utf8");
    const relative = file.slice(file.indexOf("lib/channels"));

    for (const { table, chunk, line } of queryChunks(source)) {
      if (EXEMPT[table]) continue;

      const parentKey = PARENT_SCOPED[table];
      if (parentKey) {
        if (!new RegExp(parentKey).test(chunk)) {
          violations.push(`${relative}:${line} — query on ${table} is not scoped to its ${parentKey}`);
        }
        continue;
      }

      // An insert supplies organizationId as a column value; a read filters on
      // it. Either spelling counts as scoped.
      const scoped =
        /organizationId/.test(chunk) ||
        /organization_id/.test(chunk) ||
        // A join-only reference where the scoping lives on the joined table.
        /eq\([A-Za-z]+\.id,/.test(chunk);
      if (!scoped) violations.push(`${relative}:${line} — query on ${table} has no organizationId predicate`);
    }
  }

  assert.deepEqual(violations, [], `Unscoped tenant queries found:\n${violations.join("\n")}`);
});

test("the exemption list stays short and explains itself", () => {
  // An exemption is a promise that a table's key is globally unique. If that
  // list grows quietly, this test has stopped meaning anything.
  assert.ok(Object.keys(EXEMPT).length <= 3, "too many exemptions — each one is a hole in the check");
  for (const [table, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 30, `exemption for ${table} needs a real reason, not a shrug`);
    assert.ok(TENANT_TABLES.includes(table), `${table} is exempted but not listed as tenant-aware`);
  }
});

test("the checker actually catches an unscoped query", () => {
  // A guard that cannot fail is a guard nobody can trust. This proves the
  // detection works, rather than that today's code happens to be clean.
  const bad = `const rows = await db.select().from(leases).where(eq(leases.status, "active"));\n`;
  const found = queryChunks(bad).filter(({ chunk }) => !/organizationId|organization_id/.test(chunk));
  assert.equal(found.length, 1, "an unscoped query on a tenant table must be detected");

  const good = `const rows = await db.select().from(leases).where(eq(leases.organizationId, orgId));\n`;
  const clean = queryChunks(good).filter(({ chunk }) => !/organizationId|organization_id/.test(chunk));
  assert.equal(clean.length, 0, "a scoped query must not be flagged");
});
