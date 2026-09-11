import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";

/**
 * Tenant isolation — the most important test in this codebase.
 *
 * **Read this first: what this test can and cannot prove.**
 *
 * The brief asks for an RLS isolation test. This product runs on Cloudflare
 * D1, which is SQLite, and SQLite has no row-level security — no policies, no
 * per-connection session claims, nothing for a policy to read. Org scoping is
 * enforced in application code: every query carries `where organization_id = ?`
 * and correctness rests on none of them ever forgetting it.
 *
 * So this is the honest equivalent, built to the brief's five steps, and it is
 * weaker than RLS in one specific way that matters: **it proves the paths it
 * covers and nothing about a path nobody wrote a case for.** A new query added
 * next month with a missing `where` clause would not fail this file. That gap
 * is covered separately and structurally by
 * `tests/channel-scoping.test.ts`, which reads the source of every
 * channel module and fails on a tenant-aware query with no org predicate.
 * The two together are the substitute for a policy the database would have
 * enforced for us. There is an in-flight Postgres spike
 * (`supabase/benchmark/001_spike.sql`) that does exactly that with
 * `current_setting('aval.organization_id')`; when it lands, the assertions
 * below move onto it unchanged and this comment gets shorter.
 *
 * The five steps, in order:
 *
 *   1. Two organizations with real data in each.
 *   2. **Control case first** — assert org B's rows genuinely exist. Without
 *      it every assertion below passes against an empty table and proves
 *      nothing. This is the step everyone skips.
 *   3. Act as org A through the same path production uses.
 *   4. Assert org A sees zero rows of org B's data.
 *   5. Wired as a required check (.github/workflows/pull-request.yml).
 */

const NOW = Date.now();

/** Two complete tenants, each with data in every table the channel touches. */
async function seedTwoOrganizations() {
  const sqlite = await bootRuntime();

  const run = (sql, ...params) => sqlite.prepare(sql).run(...params);

  run("INSERT OR IGNORE INTO organizations (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)", "org_a", "Alpha Properties", "user_a", NOW, NOW);
  run("INSERT OR IGNORE INTO organizations (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)", "org_b", "Bravo Realty", "user_b", NOW, NOW);
  for (const [id, email] of [["user_a", "a@example.com"], ["user_b", "b@example.com"]]) {
    run("INSERT OR IGNORE INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)", id, email, "hash", email, NOW, NOW);
  }

  // Numeric suffixes, because two of these end up inside phone numbers and a
  // letter there is not a number `normalisePhone` will ever return.
  for (const [org, suffix, digit] of [["org_a", "a", "1"], ["org_b", "b", "2"]]) {
    run("INSERT INTO properties (id,organization_id,name,country,property_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      `prop_${suffix}`, org, `${org} Riverside`, "MX", "multifamily", NOW, NOW);
    run("INSERT INTO units (id,organization_id,property_id,unit_number,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      `unit_${suffix}`, org, `prop_${suffix}`, `10${suffix}`, NOW, NOW);
    run("INSERT INTO residents (id,organization_id,display_name,phone,status,source_provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      `res_${suffix}`, org, `Resident ${suffix}`, `+525500000${digit}0`, "current", "manual", NOW, NOW);
    run("INSERT INTO leases (id,organization_id,unit_id,property_id,status,start_date,rent_cents,deposit_cents,rent_due_day,source_provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      `lease_${suffix}`, org, `unit_${suffix}`, `prop_${suffix}`, "active", NOW - 200 * 86400000, 1500000, 0, 1, "manual", NOW, NOW);
    // A charge well past due, so the delinquency gate has something to find.
    run("INSERT INTO ledger_entries (id,organization_id,lease_id,property_id,entry_type,category,amount_cents,currency,posted_at,due_at,source_provider,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      `led_${suffix}`, org, `lease_${suffix}`, `prop_${suffix}`, "charge", "rent", 2850000, "USD", NOW - 60 * 86400000, NOW - 60 * 86400000, "manual", NOW);
    run("INSERT INTO conversations (id,organization_id,channel,external_thread_id,contact_display_name,status,locale,register,last_message_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      `conv_${suffix}`, org, "whatsapp", `52550000${digit}00`, `Contact ${suffix}`, "open", "en", "professional", NOW, NOW, NOW);
    run("INSERT INTO channel_identities (id,organization_id,user_id,contact_id,channel,external_id,role,locale,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      `ci_${suffix}`, org, `user_${suffix}`, `res_${suffix}`, "whatsapp", `+525511111${digit}0`, "owner", "en", NOW, NOW);
  }

  return sqlite;
}

/** Every tenant-aware table the channel reads or writes. */
const TENANT_TABLES = [
  "channel_identities",
  "conversations",
  "leases",
  "ledger_entries",
  "residents",
  "properties",
  "units",
];

test("control case: org B's rows genuinely exist", async () => {
  // Step 2, and the reason this test is worth anything. Every assertion in the
  // file below is of the form "org A sees zero rows of org B's data". Against
  // an empty table that is trivially true, and the suite would pass green
  // while proving nothing at all. So: prove there is something to leak first.
  const sqlite = await seedTwoOrganizations();

  for (const table of TENANT_TABLES) {
    const { n } = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE organization_id = 'org_b'`).get();
    assert.ok(n > 0, `org_b must have rows in ${table} for the isolation assertions to mean anything`);
  }

  // And org A's own data exists too, or "A sees only A's" could pass by A
  // seeing nothing.
  for (const table of TENANT_TABLES) {
    const { n } = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE organization_id = 'org_a'`).get();
    assert.ok(n > 0, `org_a must have rows in ${table}`);
  }
});

test("resolving org A's number never returns org B's organization", async () => {
  // Step 3: through the real path. `resolveInbound` is the function the
  // production webhook worker calls, not a reimplementation of it.
  await seedTwoOrganizations();
  const { resolveInbound } = await import("../../lib/channels/identity.ts");

  const a = await resolveInbound("+52551111110", "whatsapp");
  assert.equal(a?.organizationId, "org_a");

  const b = await resolveInbound("+52551111120", "whatsapp");
  assert.equal(b?.organizationId, "org_b");

  // The identity carries the org. Nothing else may.
  assert.notEqual(a?.organizationId, b?.organizationId);
});

test("an unknown number resolves to no organization at all", async () => {
  await seedTwoOrganizations();
  const { resolveInbound } = await import("../../lib/channels/identity.ts");
  assert.equal(await resolveInbound("+15555550000", "whatsapp"), null);
});

test("the delinquency gate run as org A returns zero rows belonging to org B", async () => {
  // Step 4, on the query that matters most: a subscription runs unattended, so
  // a leak here sends one customer's arrears to another customer's phone with
  // no human in the loop to notice.
  await seedTwoOrganizations();
  const { delinquencyGate } = await import("../../lib/channels/gates.ts");

  const result = await delinquencyGate({ organizationId: "org_a", minCents: 1, minDays: 1 });

  assert.ok(result.fired, "org A has a 60-day-old charge, so the gate must fire — otherwise this asserts nothing");
  assert.ok(result.rows.length > 0);
  for (const row of result.rows) {
    assert.ok(!row.label.includes("org_b"), `org A's gate returned an org B row: ${row.label}`);
    assert.ok(row.label.includes("org_a"), `expected only org A rows, got ${row.label}`);
  }
  // Org A has exactly one delinquent lease. Two would mean B's leaked in.
  assert.equal(result.rows.length, 1);
});

test("the weekly summary gate run as org A totals only org A's payments", async () => {
  const sqlite = await seedTwoOrganizations();
  // Give each org a distinguishable payment this week.
  sqlite.prepare("INSERT INTO ledger_entries (id,organization_id,lease_id,property_id,entry_type,category,amount_cents,currency,posted_at,source_provider,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pay_a", "org_a", "lease_a", "prop_a", "payment", "rent", 100, "USD", NOW - 86400000, "manual", NOW);
  sqlite.prepare("INSERT INTO ledger_entries (id,organization_id,lease_id,property_id,entry_type,category,amount_cents,currency,posted_at,source_provider,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pay_b", "org_b", "lease_b", "prop_b", "payment", "rent", 999999, "USD", NOW - 86400000, "manual", NOW);

  const { weeklySummaryGate } = await import("../../lib/channels/gates.ts");
  const result = await weeklySummaryGate({ organizationId: "org_a" });

  assert.ok(result.fired);
  // Exactly org A's payment, not the sum of both.
  assert.equal(result.totalCents, 100, "org B's payment was included in org A's total");
});

test("a link code issued for org A cannot link a number into org B", async () => {
  const sqlite = await seedTwoOrganizations();
  const { consumeLinkCode } = await import("../../lib/channels/linking.ts");

  sqlite.prepare("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("CODEAAAA", "org_a", "user_a", "owner", "en", NOW + 900000, NOW);

  const outcome = await consumeLinkCode({ code: "CODEAAAA", phone: "+525599999999", channel: "whatsapp", now: new Date(NOW) });
  assert.equal(outcome.status, "linked");
  assert.equal(outcome.organizationId, "org_a");

  const row = sqlite.prepare("SELECT organization_id FROM channel_identities WHERE external_id = '+525599999999'").get();
  assert.equal(row.organization_id, "org_a");
});

test("a number already linked to org B is refused, not silently repointed", async () => {
  const sqlite = await seedTwoOrganizations();
  const { consumeLinkCode } = await import("../../lib/channels/linking.ts");

  // org_b's identity is +52551111120. Issue an org_a code and try to claim it.
  sqlite.prepare("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("STEALAAA", "org_a", "user_a", "owner", "en", NOW + 900000, NOW);

  const outcome = await consumeLinkCode({ code: "STEALAAA", phone: "+52551111120", channel: "whatsapp", now: new Date(NOW) });
  assert.equal(outcome.status, "already_linked_elsewhere");

  // The victim's identity is untouched and the code was not consumed.
  const identity = sqlite.prepare("SELECT organization_id FROM channel_identities WHERE external_id = '+52551111120'").get();
  assert.equal(identity.organization_id, "org_b", "org B's identity was repointed by an org A code");
  const code = sqlite.prepare("SELECT consumed_at FROM channel_link_codes WHERE code = 'STEALAAA'").get();
  assert.equal(code.consumed_at, null, "a refused link must not burn the code");
});

test("a link code cannot be consumed twice", async () => {
  const sqlite = await seedTwoOrganizations();
  const { consumeLinkCode } = await import("../../lib/channels/linking.ts");
  sqlite.prepare("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("ONCEONLY", "org_a", "user_a", "owner", "en", NOW + 900000, NOW);

  const first = await consumeLinkCode({ code: "ONCEONLY", phone: "+525588888888", channel: "whatsapp", now: new Date(NOW) });
  assert.equal(first.status, "linked");
  const second = await consumeLinkCode({ code: "ONCEONLY", phone: "+525577777777", channel: "whatsapp", now: new Date(NOW) });
  assert.equal(second.status, "consumed");

  const rows = sqlite.prepare("SELECT count(*) AS n FROM channel_identities WHERE external_id = '+525577777777'").get();
  assert.equal(rows.n, 0, "the second number must not have been linked");
});

test("an expired code is refused", async () => {
  const sqlite = await seedTwoOrganizations();
  const { consumeLinkCode } = await import("../../lib/channels/linking.ts");
  sqlite.prepare("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("EXPIRED1", "org_a", "user_a", "owner", "en", NOW - 1000, NOW - 100000);

  const outcome = await consumeLinkCode({ code: "EXPIRED1", phone: "+525566666666", channel: "whatsapp", now: new Date(NOW) });
  assert.equal(outcome.status, "expired");
});

test("the Mexican 1 does not create a second identity for one handset", async () => {
  // The isolation consequence of phone normalisation: if +521… and +52…
  // normalised differently, the same operator would resolve to an identity in
  // one spelling and to nothing in the other.
  const sqlite = await seedTwoOrganizations();
  const { consumeLinkCode } = await import("../../lib/channels/linking.ts");
  const { resolveInbound } = await import("../../lib/channels/identity.ts");

  sqlite.prepare("INSERT INTO channel_link_codes (code,organization_id,user_id,role,locale,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("MXCODE11", "org_a", "user_a", "owner", "en", NOW + 900000, NOW);

  // Link with the `1` spelling Meta sometimes sends.
  await consumeLinkCode({ code: "MXCODE11", phone: "+5215512345678", channel: "whatsapp", now: new Date(NOW) });

  // Resolve with the spelling it sometimes sends instead.
  const resolved = await resolveInbound("+525512345678", "whatsapp");
  assert.equal(resolved?.organizationId, "org_a", "the same handset must resolve in either spelling");

  const { n } = sqlite.prepare("SELECT count(*) AS n FROM channel_identities WHERE external_id LIKE '%5512345678'").get();
  assert.equal(n, 1, "one handset, one identity row");
});

test("three roles resolve to three different tool sets, and unlinked to none", async () => {
  const sqlite = await seedTwoOrganizations();
  const { resolveInbound } = await import("../../lib/channels/identity.ts");

  const link = (suffix, role) =>
    sqlite.prepare("INSERT INTO channel_identities (id,organization_id,user_id,contact_id,channel,external_id,role,locale,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(`ci_role_${suffix}`, "org_a", null, null, "whatsapp", `+52552222222${suffix}`, role, "en", NOW, NOW);

  link(1, "owner");
  link(2, "member");
  link(3, "resident");

  const owner = await resolveInbound("+525522222221", "whatsapp");
  const coordinator = await resolveInbound("+525522222222", "whatsapp");
  const resident = await resolveInbound("+525522222223", "whatsapp");
  const unlinked = await resolveInbound("+525500000000", "whatsapp");

  assert.equal(owner?.toolNames, null, "an owner reaches every tool the persona offers");
  assert.ok(Array.isArray(coordinator?.toolNames));
  assert.ok(!coordinator.toolNames.includes("get_accounting_breakdown"), "a coordinator has no ledger access");
  assert.deepEqual(resident?.toolNames, ["render_answer"], "a resident reaches no portfolio tool");
  assert.equal(unlinked, null, "an unlinked number has no identity, so no model call");

  // Three genuinely different sets.
  assert.notDeepEqual(owner?.toolNames, coordinator?.toolNames);
  assert.notDeepEqual(coordinator?.toolNames, resident?.toolNames);
});

test("an unverified identity row is not a credential", async () => {
  const sqlite = await seedTwoOrganizations();
  const { resolveInbound } = await import("../../lib/channels/identity.ts");
  sqlite.prepare("INSERT INTO channel_identities (id,organization_id,user_id,contact_id,channel,external_id,role,locale,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("ci_unverified", "org_a", "user_a", null, "whatsapp", "+525533333333", "owner", "en", null, NOW);

  assert.equal(await resolveInbound("+525533333333", "whatsapp"), null);
});

test("a role we do not recognise fails closed", async () => {
  const sqlite = await seedTwoOrganizations();
  const { resolveInbound } = await import("../../lib/channels/identity.ts");
  sqlite.prepare("INSERT INTO channel_identities (id,organization_id,user_id,contact_id,channel,external_id,role,locale,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("ci_weird", "org_a", "user_a", null, "whatsapp", "+525544444444", "superadmin", "en", NOW, NOW);

  assert.equal(await resolveInbound("+525544444444", "whatsapp"), null, "an unknown role must not be guessed at");
});
