# Build brief — Aval WhatsApp agent (v3)

Save at `docs/WHATSAPP_AGENT.md`. Open Claude Code with:
`read docs/WHATSAPP_AGENT.md — do the discovery step and report back before writing code`

Supersedes v1 and v2. Patterns are borrowed from four MIT-licensed projects and tagged so
you can read the source. None are dependencies; do not vendor code from any of them.

- `[DC]` **DeskcommCRM** — Next.js + Supabase + RLS, multi-tenant, WhatsApp, LatAm. Closest
  to our stack of anything public. Read this one first.
- `[NC]` **NanoClaw** — two-queue agent architecture, scheduled-task gates.
- `[MO]` **Moltis** — tool-call hooks, checkpoints, secret redaction.
- `[BSP]` **open-bsp-api** — multi-tenant org scoping on the official Cloud API.

---

## What we're building

A WhatsApp number an operator texts to query and act on their Aval data, from their phone,
without opening the dashboard. English and Spanish, per contact.

**WhatsApp is a second client of the existing backend, not a new system.** Same tool
registry, same gate, same database, same ledger. New: a transport in front, a renderer
behind, durability between. If you're writing a second set of queries, stop.

---

## Discovery — do this, then stop

1. Does `lib/integrations/catalog.ts` define Meta/WhatsApp config? What env vars beyond
   `META_WHATSAPP_APP_SECRET`?
2. State of `lib/ask-aval/` — is `handleAskAval` mounted, and where?
3. Drizzle schema: `contacts`, `users`, `organizations`? Anything like `channel_identities`?
   Shape of the session object?
4. **Do we have row-level security on tenant-aware tables today, or is org scoping enforced
   only in application code?** Answer precisely — P0.4 depends on it.
5. Is a durable queue available (Cloudflare Queues, Durable Objects)? If not, we use the
   Postgres event-log pattern in P1.2.
6. How does `i18n/` resolve locale, and what's in `terms.es-mx.json`?
7. Any tracing or metrics today?

Report all seven. Wait.

---

# P0 — Identity, isolation, linking

Nothing else is safe until this is right.

## P0.1 Schema

```
channel_identities
  id, org_id, user_id, contact_id,
  channel      text not null,       -- 'whatsapp' | 'sms' | 'imessage'
  external_id  text not null,       -- E.164, normalised
  role         text not null,       -- 'owner'|'manager'|'coordinator'|'tenant'
  locale       text not null default 'en-US',
  verified_at, created_at
  unique (channel, external_id)

channel_link_codes
  code text pk, org_id, user_id, role, expires_at, consumed_at
```

**Phone normalisation is load-bearing.** E.164 only. Mexican mobiles historically carry a
`1` after the country code and Meta's payloads are inconsistent. `normalisePhone()` with
explicit MX handling; unit-test `+521XXXXXXXXXX` and `+52XXXXXXXXXX` resolving to one
identity.

## P0.2 Linking flow

Dashboard generates a code → `wa.me` deep link with the message prefilled → user sends →
webhook matches, writes `channel_identities`, consumes code → confirmation naming org and
role. Expired or consumed codes get a plain refusal. **Never** fall back to matching on
phone number alone.

## P0.3 Resolution is the security boundary

```ts
resolveInbound(phone, channel): Promise<InboundIdentity | null>
```

- `org_id` comes from this lookup. Never from message content, never from a model argument.
- Unknown numbers: one canned reply, **no model call**.
- `role` selects the tool set before the loop starts.

## P0.4 RLS isolation test as a CI gate `[DC]`

**The most important test in the codebase.** Application-level org filtering is one forgotten
`where` clause away from a cross-tenant leak, and you cannot catch that by reading code.

Build it exactly this way:

1. Create two organizations with real data in each.
2. **Control case first:** assert org B's rows genuinely exist. Without this, the test passes
   against an empty table and proves nothing. This is the step everyone skips.
3. Simulate org A's claims **through the same auth path production policies use** — not a
   hand-rolled mock. If policies read a session claim, the test must set that claim.
4. Assert org A sees **zero** rows of org B's `contacts`, `channel_identities`,
   `conversations`, `leases`, `payments`, `agent_actions`.
5. Wire it as a required status check. A PR that breaks tenant isolation must not merge.

If discovery answer 4 says we have no RLS, say so plainly and propose adding it before
WhatsApp ships. A second client on the same data is exactly when application-only scoping
starts failing.

**Acceptance:** unlinked / tenant / manager resolve to three different tool sets, zero model
calls for unlinked, and the isolation test passes with its control case.

---

# P1 — Transport and durability

## P1.1 Webhook

- `GET /api/whatsapp/webhook` — verification challenge.
- `POST` — verify `X-Hub-Signature-256` HMAC against `META_WHATSAPP_APP_SECRET` **before
  parsing**. An unverified webhook is an open door into the database.
- Ack `200` in under a second. Meta retries slow handlers, producing duplicate sends.
- Idempotency on `message.id`. Meta redelivers.

## P1.2 Durable queue `[NC]` `[DC]`

```
webhook → inbound → worker → agent run → outbound → delivery worker → Meta
```

Two stores, **exactly one writer each**. No model call on the request path. Outbound becomes
a durable send log: a failed delivery is a row to retry, not a lost message.

Preference order: Cloudflare Queues → Durable Object per conversation → **Postgres
`event_log` table drained by a cron worker** `[DC]`. Deskcomm's rule holds in all three:
*a database trigger never makes an HTTP call.* The event log doubles as an audit trail.

## P1.3 Channel adapter registry `[NC]` `[BSP]`

`lib/channels/` ships a registry and interface; adapters self-register at startup.

```ts
interface ChannelAdapter {
  id: 'whatsapp' | 'sms' | 'imessage';
  verifyInbound(req: Request): Promise<boolean>;
  parseInbound(payload: unknown): InboundMessage;
  send(msg: OutboundMessage): Promise<DeliveryReceipt>;
  capabilities: { buttons: boolean; sessionWindowHours: number | null };
}
```

Implement `whatsapp` on the **Meta Cloud API only**. Deskcomm ships a QR-based WAHA adapter
alongside theirs and needs throttle, jitter and send-window anti-ban logic to keep it alive —
that requirement is the argument against it. Do not implement iMessage; just prove a second
adapter could slot in without touching agent code.

---

# P2 — Ask (read-only)

The whole product minus the risk. Build fully before anything writes.

Pipeline: `resolve identity → role gate → handleAskAval (read tools) → render → enqueue
outbound`. Reuse `handleAskAval` unchanged; pass locale from `channel_identities`.

## P2.1 Renderer

`lib/channels/whatsapp/render.ts` — a second view of the existing JSON answer, not a second
answer.

- Headline, figures one per line. Only `*bold*` and `_italic_`.
- Cap ~1000 chars; longer truncates with "reply MORE".
- Evidence: max 5 rows, then "and N more".
- **Every answer ends with up to 3 interactive reply buttons** for the likely next command.
  This is how users discover the command set. Without it we shipped a chatbot.

## P2.2 Onboarding

First post-link message lists five example commands verbatim, in locale. `help` / `ayuda`
returns the same, filtered by role.

**Acceptance:** "how much have I collected this month" returns a figure identical to the
dashboard tile, with buttons attached.

---

# P3 — Do (writes)

## P3.1 BeforeToolCall hook `[MO]`

One inspectable chokepoint instead of scattered permission checks.

```ts
type BeforeToolCall = (ctx: {
  identity: InboundIdentity;
  tool: ToolId;
  args: ToolArgs;
  surface: 'dashboard' | 'whatsapp';
}) => Promise<{ decision: 'allow' | 'confirm' | 'block'; reason?: string }>;
```

Hooks run in order; **any `block` wins**. Ship three:

1. `roleGate` — does this role have this tool at all.
2. `destructiveGuard` — anything touching money, calendar, or a legal notice returns
   `confirm`, never `allow`.
3. `escalationGuard` — legal, eviction, habitability, distressed tenant → `block` plus human
   notification. Write this classifier before the happy path.

The dashboard runs identical hooks. One gate, two surfaces.

## P3.2 Confirm before executing

```
"Send reminders to everyone late at Riverside"
→ "3 tenants at Riverside are 30+ days late, $28,500.
   [ See the 3 ]  [ Send reminders ]  [ Not now ]"
```

Pending action stored with 15-minute TTL; button payload carries the action id. **Batches
expand to per-recipient previews on request** — individually removable. One misdirected
delinquency notice ends a customer relationship.

## P3.3 Checkpoints and undo `[MO]`

```
action_checkpoints
  id, agent_action_id, org_id, before jsonb, reversible boolean, expires_at
```

Reversible writes reply with `[ Undo ]`. A sent WhatsApp message cannot be unsent — mark
those `reversible: false` and say so, rather than offering an undo that lies.

## P3.4 Audit and handoff `[DC]`

Every mutation emits an append-only audit row. AI is a first-class actor in that log, not a
special case — an action taken by the agent and one taken by a coordinator differ only in the
actor field. Human handoff is itself an audited event.

---

# P4 — Watch (subscriptions)

```
channel_subscriptions
  id, org_id, channel_identity_id,
  trigger text, params jsonb, schedule text, gate text,
  locale, timezone, active, created_at
```

Ship two: delinquency threshold crossed, Monday summary.

## P4.1 Script gates `[NC]`

A gate is a **deterministic SQL predicate** run before the model. Monday 08:00 fires the
gate; nothing crossed a threshold, so no model call, no message, no tokens. Without this,
every subscription pays a model call per period to discover nothing happened.

## P4.2 Adaptive follow-up `[DC]`

Deskcomm's "Radar" surfaces conversations at risk of dying without a reply, with adaptive
timing rather than a fixed interval. Our analogue: a tenant who was contacted about a
balance and hasn't replied in N days, where N adapts to that contact's historical response
latency. Feeds the same subscription table.

## P4.3 Templates

Outbound beyond the 24-hour window needs Meta-approved templates. Draft
`docs/WA_TEMPLATES.md` during P2 and submit — each locale variant is approved separately and
it is on the critical path.

---

# P5 — Cost and observability

## P5.1 Per-organization spend ceiling `[DC]`

A cap per org, not per API key. When an org approaches it, degrade rather than fail: route to
a cheaper model, then to templated responses, then notify. Silently exceeding budget and
silently going dark are both worse than a visible downgrade.

## P5.2 Tracing `[MO]`

One trace per inbound: identity resolution, tool calls with args and latency, hook decisions,
faithfulness gate result, tokens in/out, cost. Counters for inbound by channel and role,
blocked-by-hook, confirmed vs abandoned actions, gate-skipped subscription runs, delivery
failures. Cost per conversation and per org into `ai_usage` — WhatsApp bills per
conversation, not per message, so track both.

## P5.3 Scrubbing `[DC]` `[MO]`

Read `lib/sentry/scrub.ts` in Deskcomm — it substitutes national ID, phone and email, strips
sensitive headers, and redacts webhook tokens from URLs before anything reaches Sentry.
Build the equivalent: no CURP or RFC, no phone, no email, no document contents, no tokens in
any trace, log, or error report. Disable session replay on anything touching tenant data.

---

# Cross-cutting

**Locale and vocabulary `[DC]`.** Deskcomm makes pipeline vocabulary configurable per tenant
— *lead* becomes *Cliente*, *Paciente* or *Comprador*. Do the same for ours: *rent* /
*renta* / *arriendo* / *alquiler* is a per-org term map, not a translation file, because two
Mexican agencies may use different words. Locale is per contact, from `channel_identities`.
The model never picks the regional variant.

**Data protection.** Mexico's LFPDPPP is our LGPD. Prefer anonymisation over deletion,
append-only audit with long retention, consent captured on the contact record. Deskcomm's
LGPD module is the structural reference.

**Prompt injection.** Inbound text is untrusted. It cannot influence `org_id`, `role`, or
hook decisions — all resolved before the model sees anything.

---

# Do not

- Do not build a second tool registry, gate, or ledger.
- Do not let the model supply any identity argument.
- Do not use WAHA, Baileys, `whatsapp-web.js`, or anything driving WhatsApp Web. Cloud API
  only — the alternative gets a customer's business number banned.
- Do not implement iMessage. Prove the adapter interface, stop.
- Do not execute a write on first mention, or send a batch without preview.
- Do not call the model for unlinked numbers, or for a subscription whose gate is empty.
- Do not offer undo on an action that cannot be undone.
- Do not merge with the RLS isolation test failing or skipped.

# Done when

- [ ] RLS isolation test passes, with its control case, as a required CI check.
- [ ] Linking works end to end, dashboard → confirmed reply.
- [ ] `normalisePhone` tests pass for MX `+521` / `+52` equivalence.
- [ ] Invalid HMAC rejected before parsing.
- [ ] Duplicate `message.id` produces one reply.
- [ ] Webhook acks in <1s, model call off the request path.
- [ ] Three roles → three tool sets; unlinked → no model call.
- [ ] A read query matches the dashboard exactly.
- [ ] `destructiveGuard` returns `confirm` for every money-touching tool, proven by test.
- [ ] A write proposes, previews per recipient, executes on confirm, offers undo when
      reversible.
- [ ] A subscription whose gate returns nothing produces zero model calls.
- [ ] Ledger row indistinguishable from a dashboard-originated one; audit row emitted.
- [ ] Org spend ceiling degrades visibly rather than failing silently.
- [ ] One trace per inbound; no PII or tokens in any trace or error report.
- [ ] `en-US` and `es-MX` render with no missing keys.
- [ ] `npm run typecheck` and tests pass.

# Reading, not dependencies

| Repo | Read for | License |
|---|---|---|
| `melgarafael/DeskcommCRM` | RLS isolation test, `event_log` + cron workers, `lib/sentry/scrub.ts`, per-org spend cap, configurable vocabulary, dual channel adapters | MIT |
| `nanocoai/nanoclaw` | `src/router.ts`, `src/delivery.ts`, `docs/scheduled-tasks.md` | MIT |
| `moltis-org/moltis` | hook events, checkpoint/restore, secret redaction | MIT |
| `matiasbattocchia/open-bsp-api` | multi-tenant org scoping on Cloud API | Unlicense |

Read for architecture. Vendor nothing.
