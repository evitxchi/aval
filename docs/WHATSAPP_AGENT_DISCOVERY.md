# WhatsApp agent — discovery findings

Answers to the seven discovery questions in `docs/WHATSAPP_AGENT.md`. Nothing has been
built. Read the headline first: **question 4's answer changes the plan.**

---

## Headline

This codebase is **Cloudflare D1 (SQLite)**, not Postgres. SQLite has no row-level
security — no `CREATE POLICY`, no `current_setting()`, no session claims. P0.4 as the
brief specifies it **cannot be built here**. Org scoping today is application-code-only,
enforced by a `where organizationId = ?` clause in every query. The proposed replacement
is in "What I'd change" at the bottom.

Second headline: **much more of P1 already exists than the brief assumes.** The WhatsApp
webhook, HMAC verification, inbound parsing, idempotency, a durable task queue, a delivery
log, a deterministic policy gate, a hash-chained audit log, and per-step tracing are all
shipped. The real work is P0 (identity), P2.1 (renderer), P3.2 (confirm/preview), P4
(subscriptions), and P5.1/P5.3 — not the transport.

---

## 1. Does `lib/integrations/catalog.ts` define Meta/WhatsApp config?

Yes — two entries, and a third that matters.

`lib/integrations/catalog.ts:235` — **`whatsapp`** ("WhatsApp Business"), `authMode:
"credentials"`, `webhook: true`, `readOnly: false`.

- Credential fields (encrypted at rest, `lib/integrations/crypto.ts`): `businessAccountId`,
  `phoneNumberId`, `accessToken` (secret).
- Env: `META_WHATSAPP_APP_SECRET`, **`META_WHATSAPP_VERIFY_TOKEN`**, **`META_GRAPH_API_VERSION`**.
  So two env vars beyond the one the brief names. `META_GRAPH_API_VERSION` is validated
  against `/^v\d+\.\d+$/` at send time and the send throws without it
  (`lib/communications/providers.ts:23`).
- Also read at runtime but not declared in the catalog entry:
  `INTEGRATION_TOKEN_ENCRYPTION_KEY` (decrypts stored credentials) and `AVAL_PUBLIC_URL`
  (status callbacks; currently Twilio-only).

`lib/integrations/catalog.ts:252` — **`whatsapp_personal`**, `authMode: "qr_link"`. This is
the WhatsApp-Web/QR-pairing path. **The brief forbids it.** Its own catalog note already
says it is "outside WhatsApp's own terms for automated use." Recommend we leave the entry
but never route agent traffic through it, and say so in the code.

`lib/integrations/catalog.ts:264` — **`apple_messages`**, `authMode: "msp"`. Relevant only
as proof the adapter interface generalises; the brief says do not implement it.

## 2. State of `lib/ask-aval/` — is `handleAskAval` mounted, and where?

Mounted, and in good shape to reuse unchanged.

- **Definition:** `lib/ask-aval/handler.ts:50`.
- **Mount:** `app/api/assistant/ask/route.ts:18` — the only caller. Auth via
  `getApiIdentity(request)`, org from `identity.organizationId`, then
  `handleAskAval(question, env, { orgId, userId }, locale, focusedModule, personaId, isGuest, onProgress)`.
- 31 modules. The parts that matter to us: `tools.ts` (the read tool set), `loop.ts`
  (`runAskAvalLoop`, bounded at 4 tool rounds / 25s per call), `personas.ts` +
  `persona-catalog.ts` (tool narrowing per persona), `agent-router.ts` (`routeToPersona`,
  auto-routes an unqualified question to a specialist), `faithfulness.ts` (every figure in
  the narrative is verified against tool output before responding — a violation withholds
  the answer), `usage.ts` (per-org daily call cap, `AI_DAILY_CALL_CAP`, default 400).

**One integration wrinkle.** `handleAskAval` returns a `Response` whose body is the
`render_answer` JSON, not the object itself. The WhatsApp renderer will need the parsed
object. Cleanest fix is a thin `askAvalJson()` that awaits `.json()` on that Response —
no change to the handler, which is what the brief wants. Locale already threads through as
a plain string (`"en" | "es-mx"`), so passing it from `channel_identities` is a one-liner.

## 3. Drizzle schema: `contacts`, `users`, `organizations`? Anything like `channel_identities`?

`db/schema.ts`, 60 tables, all `sqliteTable`. `db/index.ts` → `drizzle-orm/d1` on binding `DB`.

| Brief asks for | Reality |
|---|---|
| `organizations` | **Yes**, `db/schema.ts:38`. Plus `organization_members` (:69) and `organization_invitations` (:99). |
| `users` | **Yes**, `db/schema.ts:25`. |
| `contacts` | **No table by that name.** The concept is split three ways: `residents` (:700, people on a lease, holds contact details), `leasing_leads` (:955, prospects), and `conversations.contactDisplayName` (:221, a denormalised string on the thread). Nothing keyed by phone number. |
| `channel_identities` | **Does not exist.** Nothing maps an external phone number to a user, role, or locale. This is the real gap and the reason P0 is P0. |

Adjacent tables we will build on, not duplicate: `conversations` (:214 — already has
`channel`, `externalThreadId`, `locale`, `register`, unique on
`(org, channel, externalThreadId)`), `messages` (:241 — unique on
`(conversationId, externalMessageId)`, which is the inbound idempotency key already),
`integration_events` (:163 — the raw webhook event log, unique on
`(provider, externalEventId)`), `communication_deliveries` (:1344 — the outbound send log
the brief asks for, with `requestKey` idempotency and a `status`/`error` column),
`answer_audit_log` (:540 — hash-chained, contiguous per-org sequence), `ai_usage` (:290 —
per-org-per-day token counts).

**Session object shape** (`lib/integrations/session.ts`):

```ts
type ApiIdentity = {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  role: WorkspaceRole;        // "owner" | "approver" | "member"
  source: AuthMode;           // "password" | "chatgpt" | "local"
}
```

Resolved by `getApiIdentity(request)` from a session cookie, then re-checked against
membership on every request (a revoked member falls back to their personal org rather than
coasting on a 30-day cookie). Ask Aval itself takes a narrower `AskAvalSession`:
`{ orgId, userId }`.

**Role mismatch to settle before P0.1.** The brief's roles are
`owner | manager | coordinator | tenant`. The codebase's are
`owner | approver | member` (`lib/organizations/roles.ts`), and they are load-bearing —
`canApprove`, `canInvite`, `canManagePolicy`, `canManageMembers` all read them. A fourth
value, `tenant`, has no analogue at all: residents are not workspace members and have no
`users` row. My recommendation is in "What I'd change".

## 4. Do we have RLS on tenant-aware tables today? — **P0 answer: no. We cannot.**

**Org scoping is enforced only in application code.** There is no row-level security, and
on this stack there cannot be:

- The database is **Cloudflare D1**, which is SQLite (`db/index.ts`, `wrangler.jsonc`
  `d1_databases`). SQLite has no RLS feature — no policies, no per-connection session
  claims, nothing for a policy to read.
- Every tenant-aware table carries `organizationId` with a foreign key to `organizations`,
  and correctness rests entirely on each query remembering `eq(table.organizationId, orgId)`.
- The generated migrations (`drizzle/0000`–`0031`) contain no `CREATE POLICY` or
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — as expected, since drizzle-kit targets
  SQLite here.

What *does* exist, and is genuinely good, is structural defence one layer up:

- `lib/agents/policy.ts` — a deterministic policy engine, explicitly documented as the
  only thing that decides whether a tool call runs, computed from three inputs the model
  cannot influence (registry entry, permission envelope, session identity).
- `lib/agents/permissions.ts` — static per-agent permission envelopes, read at execution
  time, never derived from model output.
- `PUBLIC_DEMO_ORGANIZATION_ID = "org_public_demo"` — the signed-out workspace is a fixed
  literal that provably cannot collide with a real org id (`org_${hash(userId)}`).
- Unique indexes scoped by org throughout, so a cross-tenant write collides rather than
  silently interleaving.

But the brief's own argument stands unchallenged: *"application-level org filtering is one
forgotten `where` clause away from a cross-tenant leak, and you cannot catch that by
reading code."* That is exactly our situation, and a second client on the same data is the
worst time to still be in it.

**Existing CI:** `.github/workflows/cloudflare-production.yml` runs `typecheck`, `lint`,
`npm test` — but only on push to `main`, deploy-gated. **There is no pull-request check at
all.** So even a passing isolation test has nothing to gate a merge on today. That is a
second, separable gap.

## 5. Is a durable queue available?

**No Cloudflare Queues and no Durable Objects** — neither `wrangler.jsonc`,
`wrangler.deploy.jsonc`, nor `wrangler.local.jsonc` declares a `queues` or
`durable_objects` binding, and no `DurableObject` class exists in the tree.

So we use the third option — and **the event-log-drained-by-cron pattern is already built
and running**, twice over:

- `wrangler.deploy.jsonc` has `"crons": ["* * * * *"]`, a one-minute sweep.
- `worker/index.ts:54` `scheduled()` fans out to `runImportWorker`
  (`lib/integrations/sync-worker.ts`) and `runAgentWorkerBatch` (`lib/agents/worker.ts`).
- The inbound path already does exactly what P1.2 describes: the webhook persists to
  `integration_events`, calls `queueInboundTask()` (`lib/communications/intake.ts`), which
  writes a durable `agent_tasks` row with a **content-derived deterministic id**
  (`inbound_${digestPayload({org, conversationId, messageId})}`) — so a redelivery
  dedupes on the primary key — and the cron worker drains it.
- Leasing is real: `integration_sync_state` carries `leaseToken` / `leaseExpiresAt`, so
  one writer per connection is already enforced.
- Outbound already has its durable send log: `communication_deliveries`, unique on
  `(organizationId, requestKey)`, with `status` and `error` columns to retry from.

Deskcomm's rule ("a database trigger never makes an HTTP call") holds trivially — D1 has
no triggers doing anything of the kind.

**Caveat the brief should know about.** `app/api/webhooks/[provider]/route.ts` currently
makes an LLM call on the *inbound* path via `draftAutoReply`, scheduled through
`ctx.waitUntil(...)` so the ack still goes out immediately. On plain Node (local dev)
`getRequestExecutionContext()` returns null and it becomes a detached, best-effort
promise. That is off the *response* path but not off the *request* path, and the WhatsApp
agent must not inherit it — the agent run belongs in the cron-drained task, which is where
`queueInboundTask` already puts it.

## 6. How does `i18n/` resolve locale, and what's in `terms.es-mx.json`?

**Locale resolution** is `next-intl`, path-segment-based:

- `i18n/request.ts` — `getRequestConfig` reads `requestLocale`, falls back to
  `routing.defaultLocale` if it is not in `routing.locales`, and imports
  `messages/${locale}.json`.
- `app/[locale]/routing.ts` defines the locale set; `middleware.ts` wires the routing.
- Messages: `messages/en.json`, `messages/es-mx.json`. Parity is enforced in CI by
  `npm run i18n:check` (`scripts/check-i18n-parity.mjs`), already part of `npm test` —
  which covers the brief's "`en-US` and `es-MX` render with no missing keys" for free,
  provided we put our strings in those files.

Note the locale codes here are **`en` and `es-mx`**, not the brief's `en-US` / `es-MX`.
`conversations.locale` defaults to `"en"` and `handleAskAval` branches on `locale === "es-mx"`.
`channel_identities.locale` should store the codebase's spelling, not the brief's.

**`terms.es-mx.json`** (repo root) is a **terminology decision record**, not a message
catalogue — 5 entries, each `{ term, avoid?, note, diverges_from_brief? }`, written for
translators and reviewers. It already encodes the exact judgement the brief's
cross-cutting section calls for: `renta` not `alquiler` (Mexican, not Spain Spanish);
`unidad` not `departamento`; `residente` not `inquilino` (matching the English copy's
deliberately warm "resident" register, with a note to use `inquilino` only in genuinely
contractual copy). It is currently documentation — nothing reads it at runtime.

So the per-org term map the brief asks for does not exist yet, but the vocabulary
questions it would answer have already been thought through once, and
`communication_settings.configJson` (:1360) is the natural place to hang per-org overrides.

## 7. Any tracing or metrics today?

Tracing yes, metrics essentially no, error reporting none.

**Tracing (good).** `agent_task_steps` persists one row per step with `kind`,
`modelProvider`, `modelName`, `tool`, `policy` decision, `denyCode`, `risk`, and
provenance; `lib/agents/trace-view.ts` is the tested pure-presentation layer over it, and
`app/components/agent-trace.tsx` renders it. This is close to the per-inbound trace P5.2
wants — it is missing latency-per-tool-call and per-turn cost.

**Redaction (good, and reusable).** `lib/agents/redaction.ts` redacts tool arguments for
audit digests and approval cards, inverting the default — a value is withheld unless it is
provably safe (a schema enum, or identifier-shaped). `lib/agents/monitoring.ts` sends
payload-free operational alerts over HTTPS only, with an explicit rule that no goal,
argument, result, tenant name, or financial value may enter the shape. There is a test at
`tests/agent-injection-redaction.test.ts`.

**Cost accounting (partial).** `ai_usage` holds per-org-per-day input/output tokens;
`lib/ask-aval/usage.ts` enforces a daily *call* cap (`AI_DAILY_CALL_CAP`, default 400) and
a token balance. So P5.1's ceiling exists in skeleton, but it is a hard block, not the
graceful degradation the brief asks for, and it counts calls rather than spend.

**Missing entirely:** no Sentry, no OpenTelemetry, no counters, no
`lib/sentry/scrub.ts` equivalent as a general-purpose scrubber (the redaction that exists
is argument-shaped, for audit digests — not a transport-level scrubber for logs and error
reports). Cloudflare Workers observability is enabled (`wrangler.deploy.jsonc`,
`head_sampling_rate: 1`), so raw `console.error` lines land in Workers Logs — and several
existing `console.error` calls in the webhook route log provider names and error messages
without passing through any scrubber.

---

## What I'd change in the brief, and why

Four things. Everything else lands as written.

**1. P0.4 — replace "RLS isolation test" with "org-scoping isolation test."** We cannot
enforce isolation in the database on D1. Adding real RLS would mean moving off D1 to
Postgres (Hyperdrive/Neon), which is a much larger decision than WhatsApp should force.
What we *can* build keeps every structural property of the brief's design except the
enforcement layer:

1. Two orgs with real data in each (the harness at `tests/integration/harness.mjs` already
   builds a real SQLite DB from our own migrations, so this is faithful, not mocked).
2. **Control case first** — assert org B's rows genuinely exist. Non-negotiable, and the
   brief is right that it is the step everyone skips.
3. Drive org A **through the same path production uses** — `getApiIdentity` → the tool
   registry → `evaluatePolicy` → the actual query functions. Not a hand-rolled mock. Since
   our boundary is application code, the test must exercise application code.
4. Assert zero rows of org B's data across every tenant-aware table we touch.
5. Wire it as a required check — which means **first creating a pull-request CI workflow**,
   since none exists.

This is weaker than RLS and I want to be plain about that: it proves the paths it covers,
and proves nothing about a path nobody wrote a case for. Recommend we pair it with a
static check that every `db.select()` on a tenant-aware table carries an `organizationId`
predicate — cheap, catches the forgotten-`where` case by construction, and does not depend
on a test remembering to cover a table. **Recommendation: treat "add Postgres + real RLS"
as its own tracked decision, not a WhatsApp subtask.**

**2. P0.1 — reconcile roles.** Map the brief's roles onto ours rather than inventing a
parallel set: `owner → owner`, `manager → approver`, `coordinator → member`. `tenant` is
genuinely new and should *not* become a `WorkspaceRole` — a resident is not a workspace
member and must never resolve to one. Recommend `channel_identities.role` be its own
column typed `WorkspaceRole | "resident"`, with `resident` selecting a tool set that is
strictly read-only-about-oneself. This keeps `lib/organizations/roles.ts` intact.

**3. P1.1/P1.2 — reuse, don't rebuild.** The brief's webhook requirements are already met
at `app/api/webhooks/[provider]/route.ts`: HMAC verified before parsing (:44), constant-time
compare, `GET` challenge handled (:146), idempotency on both `integration_events` and
`messages`, ack under a second. P1 is mostly a diff, not a build. The two real changes:
route the agent run through `queueInboundTask` rather than the inline `draftAutoReply`
path, and add the `channel_identities` lookup between parse and enqueue.

**4. P3.1 — `BeforeToolCall` is `evaluatePolicy`.** `lib/agents/policy.ts` already returns
`allow | deny | require_approval`, which is the brief's `allow | block | confirm` under
different names, already runs on the dashboard, and is already the documented single
chokepoint. Building a second hook type would violate the brief's own "do not build a
second gate." Recommend the three hooks ship as *policy rules* inside the existing engine,
with `surface: 'dashboard' | 'whatsapp'` added to `PolicySubject`. `escalationGuard` is
genuinely new and I agree it should be written before the happy path.

## Suggested build order, given what exists

P0 identity (all new) → P0.4 isolation test + **a PR CI workflow to gate it on** → P1 as a
diff to the existing webhook → P2 renderer + onboarding → `docs/WA_TEMPLATES.md` submitted
early, since Meta approval is on the critical path and each locale is approved separately →
P3 as policy rules + the confirm/preview layer → P4 → P5.
