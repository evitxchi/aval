# WhatsApp agent — what was built

Against `docs/WHATSAPP_AGENT.md`. Discovery answers are in
`docs/WHATSAPP_AGENT_DISCOVERY.md`.

## Done when — the brief's own checklist

| | Criterion | Where |
|---|---|---|
| ✅ | RLS isolation test passes, with its control case, as a required CI check | See the caveat below. `tests/integration/channel-isolation.integration.mjs` + `.github/workflows/pull-request.yml` |
| ✅ | Linking works end to end, dashboard → confirmed reply | `app/api/channels/link/route.ts`, `lib/channels/linking.ts`, tested in `channel-pipeline.integration.mjs` |
| ✅ | `normalisePhone` tests pass for MX `+521` / `+52` equivalence | `tests/channel-phone.test.ts` |
| ✅ | Invalid HMAC rejected before parsing | `lib/channels/whatsapp/protocol.ts`, `tests/channel-adapter.test.ts` |
| ✅ | Duplicate `message.id` produces one reply | `lib/channels/queue.ts`, unique index on `(provider, external_event_id)` |
| ✅ | Webhook acks in <1s, model call off the request path | Webhook enqueues only; every model call is in the cron worker |
| ✅ | Three roles → three tool sets; unlinked → no model call | `lib/channels/roles.ts`, asserted in both integration suites |
| ✅ | A read query matches the dashboard exactly | One shared formatter, `lib/ask-aval/format-metric.ts` |
| ✅ | `destructiveGuard` returns `confirm` for every money-touching tool, proven by test | `tests/integration/channel-hooks.integration.mjs`, over the whole registry |
| ✅ | A write proposes, previews per recipient, executes on confirm, offers undo when reversible | `lib/channels/actions.ts` + pipeline |
| ✅ | A subscription whose gate returns nothing produces zero model calls | `lib/channels/gates.ts`, `subscription-worker.ts` |
| ✅ | Ledger row indistinguishable from a dashboard-originated one; audit row emitted | `lib/channels/audit.ts` into the existing hash chain |
| ✅ | Org spend ceiling degrades visibly rather than failing silently | `lib/channels/budget.ts` |
| ✅ | One trace per inbound; no PII or tokens in any trace or error report | `lib/channels/trace.ts`, `scrub.ts` |
| ✅ | `en-US` and `es-MX` render with no missing keys | `lib/channels/copy.ts` — a concrete type, so a missing key fails `tsc` |
| ✅ | `npm run typecheck` and tests pass | 609/611 unit, 195/195 runtime |

**Two caveats on that table, stated plainly.**

1. **The isolation test is not an RLS test**, because D1 is SQLite and cannot
   have one. It is the closest honest equivalent — two orgs, control case
   first, driven through the real resolution path — paired with a static check
   (`tests/channel-scoping.test.ts`) that fails on any channel query missing an
   `organizationId` predicate. Together they cover more than a test alone. They
   are still weaker than a database policy, and the file says so in its header.

2. **The two failing unit tests are pre-existing and environmental**: they need
   `npm ci --prefix desktop` and a vendored Codex binary. Neither is touched by
   this work; `npm test` runs the desktop install first.

## Not built, deliberately

- **iMessage.** The brief says prove the interface generalises and stop. A
  second adapter is registered in a test; no iMessage code exists.
- **WAHA / Baileys / whatsapp-web.js.** Forbidden by the brief and by
  `lib/integrations/catalog.ts`'s own note on `whatsapp_personal`. Meta Cloud
  API only.
- **A second tool registry, gate, or ledger.** The hooks are rules over
  `lib/agents/policy.ts`; the audit rows go into the existing hash chain; the
  send log is the existing `communication_deliveries`.

## Left for a person

1. **Submit `docs/WA_TEMPLATES.md` to Meta.** Four templates × two locales,
   approved independently. This is the longest-lead item and nothing in P4 can
   ship without it.
2. **Turn on the required status check.** `.github/workflows/pull-request.yml`
   defines a "Tenant isolation" job, but branch protection has to name it:
   Settings → Branches → main → Require status checks. Until then it reports
   and merges anyway.
3. **A resident-scoped read tool.** `toolNamesForRole("resident")` is
   deliberately near-empty: every tool in `lib/ask-aval/tools.ts` aggregates
   across the portfolio, so answering a resident's "what do I owe?" would
   answer with what the building owes. Residents are handed to a human until a
   `get_my_balance` keyed on `channel_identities.contactId` exists.
4. **Decide on `lib/ask-aval/export.ts`'s formatter.** It rounds currency and
   pins `en-US`, so a document export already disagrees with the screen — this
   predates the channel. Left alone because changing it changes every generated
   PDF, DOCX, PPTX and XLSX, which is a call worth making on purpose.
5. **Wire the follow-up worker.** `lib/channels/follow-up-store.ts` finds
   candidates and is tested; nothing calls it from the cron yet, because who
   gets chased and with what wording is a product decision, not a technical one.

## Where things live

```
lib/channels/
  phone.ts            normalisePhone, the identity key
  identity.ts         resolveInbound — the security boundary
  identity-types.ts   shapes, storage-free
  roles.ts            ChannelRole, tool sets per role
  linking.ts          code issue and consumption
  registry.ts         ChannelAdapter interface + registry
  whatsapp/
    protocol.ts       HMAC verification + payload parsing (pure)
    adapter.ts        send, self-registration
    render.ts         the second view of an existing answer
  pipeline.ts         inbound routing; every cheap check before the model
  ask-bridge.ts       handleAskAval, reused unchanged
  queue.ts            durable inbound log
  worker.ts           the cron drain — where model calls happen
  outbound.ts         durable send log
  hooks.ts            roleGate / destructiveGuard / escalationGuard
  escalation.ts       deterministic classifier, both locales
  actions.ts          propose / confirm / checkpoint / undo
  action-format.ts    payload parsing and previews (pure)
  gates.ts            deterministic SQL run before the model
  subscriptions       subscription-worker.ts, schedule.ts
  budget.ts           spend tiers; budget-store.ts reads usage
  follow-up.ts        adaptive timing; follow-up-store.ts finds candidates
  audit.ts            into the existing hash chain
  trace.ts            one span per inbound
  scrub.ts            CURP, RFC, phone, email, tokens
  copy.ts             every fixed string, both locales
  vocabulary.ts       per-org term map
```

Migrations `0032` and `0033` are additive: six new tables, no drops, nothing
applied to production yet.
