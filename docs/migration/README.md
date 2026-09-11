# Lean Supabase migration: implementation and handoff

Status: **Clean-install PostgreSQL schema and RLS foundation implemented; hosted Supabase setup and runtime cutover pending.** Aval's application still runs on D1. Connecting a Supabase URL does **not** switch the application to PostgreSQL. The generated PostgreSQL schema now covers all 67 current tables, including the enterprise hierarchy and identity tables, but repository conversion, Supabase Auth, Hyperdrive configuration and cutover remain future work.

The user confirmed there is no customer data in Cloudflare and will create the Supabase project later. The connected Cloudflare account returned no visible D1 databases and the registered Sites project was unavailable to this session, so no remote row count was independently collected. The implementation therefore uses a **clean Supabase install** and does not build an unnecessary customer-data exporter. Any old D1 instance must remain untouched until its deployment identity is confirmed and the new empty-install smoke passes.

## What this branch implements

| Component | Implementation and limit |
| --- | --- |
| Generated inventory | Replays the current migration journal into SQLite, compares tables, columns, indexes and foreign keys with actual Drizzle metadata; includes migration hashes, trigger SQL/hashes and database consumers. Current result: 67 tables, 33 migrations, 6 triggers, 70 runtime `getDb()` consumers. Counts are derived, never acceptance constants. |
| PostgreSQL schema | Generates a clean 67-table `pg-core` schema and Supabase migration from the checked-in D1 model. Existing text IDs stay text; timestamps become `timestamptz`; structured JSON becomes `jsonb`; money/token/micro-unit counters become `bigint`; utility usage becomes `numeric`. |
| Enterprise hierarchy | Adds principals, identity links, SSO metadata, ownership entities, portfolios, regions, scoped access grants and scoped approval authority. Property and scope relationships include the organization in composite foreign keys. |
| Default-deny RLS | Enables and forces RLS across all organization-owned tables, requires transaction-local principal/organization context, applies property/portfolio/region/owner scope checks and prevents removal of the final active organization administrator. The policies are generated from the current inventory. |
| Production preflight | Generates read-only table counts, schema, integrity checks, status counts, money/token totals and audit heads. Does not export personal data or assume missing access means an empty database. |
| PostgreSQL session | `pg` + Drizzle, one request-scoped client, explicit identity and transaction, fixed restricted database roles, parameterized transaction-local context, timeouts, rollback and connection cleanup. Currently used only by the spike. |
| Representative fixture | Isolated `aval_benchmark` schema: 10 organizations, 10,000 properties, 10,000 tasks, memberships and append-only audit rows. Includes text IDs, bigint amounts, JSONB, timestamps and a composite tenant foreign key. |
| Atomic operations | Fixture property mutation plus audit/head update in one transaction; parent-row audit locking; idempotent requests; `SKIP LOCKED` task claiming; increasing lease generations and expiry checks on checkpoints. These are tested patterns, not changes to the production domain repositories yet. |
| Tenant controls | The synthetic benchmark retains its isolated membership fixture. The clean application migration separately contains enterprise hierarchy policies; these still require local/hosted negative-policy validation before runtime cutover. |
| Hosted benchmark | Separate, token-protected, synthetic-only Worker; 1/10/50/100 concurrent list/write/claim probes, read-after-write and tenant checks; source fingerprint and explicit evidence gate. No production app bindings are reused. |
| Local environment/CI | Supabase CLI configuration plus a CI job using real PostgreSQL 17. Storage and Realtime remain disabled. No automatic cloud deployment. |

The temporary benchmark Worker is measurement infrastructure. Aval's production runtime remains one Worker with its existing cron; this does not introduce a second production job runtime.

## Run the inventory

```sh
npm run db:inventory
npm run test:migration
```

Outputs are [inventory.json](./inventory.json) and [production-preflight.sql](./production-preflight.sql). Source hashes normalize CRLF to LF so Windows and Linux produce the same inventory. Future data-export manifests must hash exact exported bytes, not normalized source.

The inventory preserves triggers from migrations as well as Drizzle declarations. The PostgreSQL generator converts fields explicitly named `*Json`, integer timestamp modes, money/token/micro counters and utility usage. Other text remains text and opaque provider evidence is not reinterpreted. No ID remapper or `legacy_id_map` exists.

## Create the clean backend later

After creating a dedicated Supabase project in US West:

1. Install Docker and the Supabase CLI, then run `npx supabase start`.
2. Run `npx supabase db reset` and execute `npm run test:postgres` against a fresh local test database.
3. Run `npm run db:inventory`, `npm run db:postgres:schema`, and `npm run db:postgres:publish`; the generated files must produce no Git diff.
4. Link the intended hosted project with `npx supabase link --project-ref YOUR_PROJECT_REF`.
5. Run the dedicated Hyperdrive benchmark below before changing application repositories.
6. Only after the benchmark and RLS tests pass, apply the checked-in migrations with `npx supabase db push`.

The two production migrations are [the clean PostgreSQL backend](../../supabase/migrations/20260910000100_postgres_backend.sql) and [default-deny RLS](../../supabase/migrations/20260910000200_default_deny_rls.sql). Do not expose the direct database password to browser code.

Before executing the SQL remotely, verify the exact account, database ID, Worker deployment and Sites deployment, and record the answers in [production-sources.json](./production-sources.json). A database's absence from the current account is not proof of nonexistence. Account classification, pending external outcomes and provider connectivity require a read-only operational review after the source is found. Keep query results private under `outputs/migration/`.

## Local Supabase setup

Requires Node 22.20+, npm, Supabase CLI and a working Docker engine. No hosted project or API/model balance is required for the fixture tests.

1. Run `npm ci`, then `supabase start` from this repository.
2. Copy `supabase/benchmark/environment.example` to `.env.migration.local` at the repository root. This file is ignored by Git. Use the local connection details from `supabase status`.
3. Choose separate random values of at least 32 characters for `AVAL_BENCHMARK_DB_PASSWORD` and `AVAL_BENCHMARK_TOKEN`. Put the URL-encoded DB password in `AVAL_BENCHMARK_DATABASE_URL`. Never put the admin connection string in the Worker.
4. Run `npm run db:spike:setup`. This only creates the isolated fixture schema and restricted login. It refuses to overwrite an existing fixture schema; it does not run Aval's future parity migrations.
5. Run `npm run db:spike:serve` in one terminal and `npm run db:benchmark` in another.

The local benchmark intentionally exits nonzero at the hosted gate. Its local timings can debug the harness but cannot establish Worker → Hyperdrive → Supabase performance. Under local direct connections, high-concurrency runs may hit the restricted login's 15-connection ceiling. That is not an instruction to increase a production pool; measure the hosted pooled path separately.

For `npm run test:postgres`, set `AVAL_TEST_DATABASE_URL` to a **fresh disposable local database** separate from the spike used for manual load tests. The suite needs a local administrator to create its fixture schema and a temporary restricted login; business operations themselves run through that restricted login and role. It rejects remote destinations, refuses to overwrite an existing schema and does not silently skip when the database is missing. The CI workflow provisions a fresh PostgreSQL 17 service automatically. Local Supabase uses the same PostgreSQL suite; these tests do not yet exercise Supabase Auth.

On the implementation machine Docker failed to become ready. The suite was therefore also run on an isolated native PostgreSQL 17.10 instance, listening only on loopback and shut down afterward. This validates PostgreSQL semantics; it is not a Supabase or Hyperdrive integration claim.

## Plug in a hosted benchmark later

Use a **dedicated Aval Free project in US West (Oregon)** for the synthetic fixture. Do not point setup or load tests at a project containing customers. Supabase setup is the user's deferred handoff.

1. Set the admin URL for that project in the ignored environment file and set `AVAL_BENCHMARK_DEDICATED_PROJECT=yes`. The admin URL may use Supabase's session pooler from an IPv4-only laptop; **Hyperdrive itself must use the direct database endpoint**.
2. Run `npm run db:spike:setup`. Keep the resulting restricted `aval_benchmark_login` credential separate from the admin credential.
3. Create a Hyperdrive configuration against that restricted login on the direct Supabase endpoint. Disable query caching. Set a conservative origin connection pool and account for Supabase services and other users of the database. Do not grant the login `postgres`, `service_role`, object ownership or `BYPASSRLS`.
4. Set the actual `AVAL_HYPERDRIVE_ID` and `AVAL_SUPABASE_PROJECT_REF` in the environment file, then run `npm run db:spike:configure`. This generates `outputs/migration/wrangler.benchmark.json`, with US West targeted placement and the current code fingerprint. It refuses placeholder IDs. It does not change Aval's existing Wrangler files.
5. Deploy only this isolated benchmark configuration and set its HTTP secret:

```sh
npx wrangler deploy --config outputs/migration/wrangler.benchmark.json
npx wrangler secret put BENCHMARK_TOKEN --config outputs/migration/wrangler.benchmark.json
```

The secret command prompts for the same value as `AVAL_BENCHMARK_TOKEN`; don't place it on a command line or commit it. The endpoint denies requests until the secret exists. Set `AVAL_BENCHMARK_URL` to the returned HTTPS origin. Public `oai-authenticated-*` headers do not authenticate to this Worker.

6. Copy `supabase/benchmark/connection-evidence.example.json` to `outputs/migration/connection-evidence.json`. Fill it from the actual project region, Hyperdrive configuration, Worker placement, the effective connection limit and the **observed peak origin connections during the run**. Its defaults deliberately fail. These are operator-supplied evidence, not automatically verified cloud metrics; retain supporting screenshots/API exports privately.
7. Run `npm run db:benchmark` from the intended US West test path. It issues at least 100 requests per operation/concurrency combination, records errors and client-observed HTTP latency, and checks every returned tenant/task. It verifies read-after-write using a new DB session and checks transaction context on every session.
8. Run `npm run db:benchmark:gate -- outputs/migration/benchmark.json`. Only passing, recent evidence for the current source, correct hosted route, zero errors, correct RLS role, unique task generations, read-after-write, expected regions, disabled caching and adequate measured connection headroom permits Phase 1.

Read p95 must be ≤300 ms; write/claim p95 ≤500 ms. The reported ingress colo is supplementary routing evidence; it is not presented as the Worker execution region. Region verification uses the deployed placement configuration. End-to-end HTTP timing includes network and response transfer and is intentionally conservative.

If it fails, inspect the phase timings/connection use and reduce round trips or consolidate high-traffic operations into parameterized SQL functions. Do not waive the gate by changing the report, raising the thresholds or labelling local results hosted. Regenerate the configuration and rerun after code changes. Delete/disable the synthetic benchmark deployment after collecting evidence.

Source: [Cloudflare's Supabase connection guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) and [Hyperdrive pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).

## Subsequent implementation phases

The approved scope and ordering remain intact:

| Phase | Remaining work and gate |
| --- | --- |
| 0: production facts | Resolve all deployment/database sources or document evidence of no production installation. Count/classify data, users, pending operations and audit heads. Hosted benchmark must pass before broad repository conversion. |
| 1: parity | The 67-table PostgreSQL schema and clean migrations exist. Port all application repositories at identical behavior; keep text IDs and external IDs; preserve migration-only triggers. Retain D1 only during validation. Replace raw SQLite/D1 storage paths and test actual PostgreSQL queries. |
| 2: atomicity | Migrate financial policy lock/reservation/event/audit, approvals/votes/finalization/resume/audit, audit append, imports, invitation redemption, initial task/audit and Stripe inbox+mutation. Extend fencing to all checkpoint/heartbeat/finalization paths, including reconciliation. |
| 3: authorization/Auth | Schema, hierarchy, identity-link tables and generated RLS exist. Validate the policies against local and hosted Postgres, integrate them into every route, and replace every global `getDb()` consumer with explicit sessions. Replace password hashes/HMAC sessions via verified Supabase Auth setup links and a documented rollback window. Never merge accounts by email alone. |
| 4: rehearsal/cutover | Use the confirmed empty-install path: verify deployment identity, preserve old D1 without mutation, apply the clean Supabase migrations, create Auth users, switch the Worker, run Auth/RLS/agent smoke checks and reopen. If any customer data is discovered, stop and restore the snapshot/export rehearsal gates before proceeding. |
| 5: separate releases | Billing ledger before charging customers, Storage/documents, maintenance, Realtime, larger evaluations, then queue/runtime split only if measurements justify it. |

Nonnegotiable transaction boundary: commit the idempotent reservation/outbox command, call the external provider, then record the result in a new transaction. Never hold locks across model/provider HTTP. A lost commit response is an unknown outcome; the session helper does not blindly retry it.

The hierarchy must keep `organization_id` as the SaaS security boundary and include it in every entity relationship. Membership alone is not authority. Final scoped grants must use the fixed owner→org_admin, approver→approver, member→operator mapping; support property/portfolio/region/owner scopes and transactional protection against removing the last administrator. The fixture's simpler membership policy must not be copied as final enterprise authorization.

ChatGPT Sites is a separate deployment surface from the standalone Cloudflare Worker. Final integration must verify a trusted bridge/deployment boundary; the current production identity handler has **not** been migrated or secured by this spike. The benchmark's header rejection test says nothing about those existing routes.

## Recovery and release acceptance still outstanding

Backups are **not configured or active** on this branch. Before cutover, implement the official Supabase roles/schema/data dumps, Auth/migration restoration state and a project/configuration manifest; encrypt before private R2 upload; verify checksums and retrieval; retain 14 daily/eight weekly backups through lifecycle policies. Restore into local Supabase monthly and before each database migration release, including authenticated smoke checks. Credentials/project secrets require separately protected recovery material; a database dump alone does not restore every hosted setting.

Targets remain up to 24 hours of data loss and eight hours to restore, with no PITR/HA promise. Storage object bytes need separate backups when Storage ships. See [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).

Cutover additionally requires all application checks, scoped RLS negative tests, concurrency/import/Auth/billing/audit tests, the six-case durable-agent smoke on staging and production, and a verified backup restoration. The prior six-case agent evaluation is not superseded by database fixture tests. No production path may import D1/SQLite/global `getDb()` at completion. D1 remains read-only for 30 days; after Postgres accepts new writes recovery must move forward, never revert to stale D1.

Upgrade decisions remain: 350 MB database, 700 MB future Storage, 80,000 Hyperdrive queries/day, contractual controls/recovery/SAML needs, or the second paying customer. No paid resources were provisioned here. The hosted [SAML feature](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml) requires an eligible paid tier and actual customer IdP configuration.

See [validation.md](./validation.md) for what was actually run. No deployment, live benchmark, customer data migration, account-reset email or macOS DMG release has been performed by this phase.
