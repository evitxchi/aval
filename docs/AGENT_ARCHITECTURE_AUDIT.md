# Aval Agent Architecture Audit

Traced from UI invocation through backend execution on the working tree at
`4567dff`. Every claim below cites the code path it was read from. Nothing was
inferred from a filename.

---

## 1. Current architecture

```text
app/components/aval-assistant.tsx  (client)
        │  POST { question, locale, moduleLabel?, moduleSnapshot?, personaId? }
        ▼
app/api/assistant/ask/route.ts
        │  getApiIdentity(request)   ← session cookie / platform header / guest
        │  ensureOrganization(identity)
        ▼
lib/ask-aval/handler.ts
        │  routeToPersona(question)         ← deterministic local keyword scorer
        │  resolvePersona(id, orgId)        ← 8 built-ins + org-scoped custom rows
        │  personaTools(TOOLS, persona)     ← filters the SCHEMA LIST only
        ▼
lib/ask-aval/loop.ts   runAskAvalLoop()          ◀── THE ONE SHARED RUNTIME
        │  checkUsageBlocked()  → 402 token_balance / 429 daily_cap
        │  ┌─ for round in 0..3 ────────────────────────────────┐
        │  │  callModel(env, orgId, {system, messages, tools})  │
        │  │        └─ lib/ask-aval/model-router.ts             │
        │  │             ├ Aval's own Anthropic key (default)   │
        │  │             ├ org API key (OpenAI-compatible)      │
        │  │             └ org OAuth subscription (Claude/GPT)  │
        │  │  toolUses = res.content.filter(type === tool_use)  │
        │  │  if (render_answer) → faithfulness gate → RETURN   │
        │  │  for use of toolUses:                              │
        │  │      runTool(use.name, use.input, session.orgId)   │  ← no authz check
        │  │      seenNumbers += out.numbers                    │
        │  │      auditEvents += {tool_call, digest}            │
        │  │  messages.push(tool_results)                       │
        │  └────────────────────────────────────────────────────┘
        │  round 3 forces tool_choice = render_answer
        ▼
lib/ask-aval/faithfulness.ts   checkFaithfulness(answer, seenNumbers)
        │  violation → 502, answer withheld, audit "verdict:fail"
        ▼
lib/audit/log.ts   appendAuditEvents(orgId, events)   ← one batched write
        │  hash-chained, digest-only (lib/audit/chain.ts)
        ▼
Response.json({ headline, narrative, metrics[], chart?, evidence_ids[], ... })
```

Tool execution fans out to two families:

```text
lib/ask-aval/tools.ts   runTool()
   ├─ runOperationsTool()  → lib/operations/*  (records: units, leases, ledger,
   │                          work orders, leads, GL, vendors, conflicts)
   └─ snapshot executors   → lib/ask-aval/portfolio-data.ts (portfolio_snapshots)
```

**Finding: this is one execution layer, not eight backends.** `PERSONAS` in
`lib/ask-aval/personas.ts` is a `Record<PersonaId, {id, label,
systemPromptAddition, toolNames}>`. All eight agents call the identical
`runAskAvalLoop`, the identical faithfulness gate, the identical metering, and
the identical model router. That is the correct shape and is worth preserving —
it is exactly what §18 of the guide asks for.

---

## 2. Agent-by-agent scorecard

All eight share: entry point (`/api/assistant/ask`), runtime (`runAskAvalLoop`),
model resolution (`model-router.ts`), state (in-memory `messages[]`,
`seenNumbers`, `toolsUsed` — discarded when the HTTP request ends), tool
selection (dynamic, model-chosen, from a persona-filtered schema list),
iteration (up to 4 rounds, results observed before the next decision, replanning
possible within those rounds), termination (`render_answer` called, or round 4
forces it), timeout (25s per model call, `lib/ask-aval/anthropic.ts:35`), retry
(SDK `maxRetries: 2` on the model call only — never on a tool), persistence
(none), crash recovery (none), delegation (none), parallel execution (tool calls
within one round run sequentially in a `for` loop), approvals (none),
authorization (org id from session, never from the model), audit
(`answer_audit_log`, digest-only, hash-chained), idempotency (none), rate limits
(daily call cap, **skipped entirely for BYO-credential orgs**, `usage.ts:72`),
secrets (server-side, AES-encrypted in `integration_connections`, never in a
prompt), prompt injection (system-prompt instruction + `read_document` numbers
withheld from the gate).

| Agent | Tools granted (`personas.ts`) | Mutating tools | Current level |
|---|---|---|---|
| Financial Analyst | `get_portfolio_metrics`, `get_metric_series`, `get_accounting_breakdown`, `get_operating_statement`, `get_delinquent_accounts` | none | 2⁻ |
| Brokerage & Leasing | `get_leasing_funnel`, `get_property_breakdown`, `get_metric_series`, `get_leasing_velocity` | none | 2⁻ |
| Real Estate | `get_property_breakdown`, `get_portfolio_metrics`, `get_leasing_velocity` | none | 2⁻ |
| Market Research | `get_metric_series`, `get_portfolio_metrics`, `get_leasing_funnel`, `get_leasing_velocity` | none | 2⁻ |
| Maintenance | `get_portfolio_metrics`, `get_delinquent_accounts`, `get_maintenance_performance` | none | 2⁻ |
| Risk Analyst | `get_delinquent_accounts`, `get_portfolio_metrics`, `get_accounting_breakdown`, `get_operations_insights`, `get_data_conflicts` | none | 2⁻ |
| Portfolio Outlook | `get_metric_series`, `get_portfolio_metrics`, `get_operating_statement`, `get_operations_insights` | none | 2⁻ |
| Lease Review | `list_documents`, `read_document` | none | 2⁻ |

Plus `record_preference` and the final answer tool, always appended
(`personaTools()`). `record_preference` is the **only mutating tool in the
system** and it is constrained to a fixed enum of topic/statement pairs, checked
server-side in `tools.ts` before the write.

**`2⁻` means:** genuinely agentic execution (dynamic tool selection, real
observe-then-decide iteration, replanning within the round budget, explicit
stopping criteria) but **no durable task state**, so it fails Level 2's
"maintains task state" in the sense the guide means it — state lives only in one
HTTP request's memory and is destroyed on completion or crash.

### What is genuinely agentic

- Tool selection is the model's, not a hard-coded sequence. There is no
  `if question.includes("noi") then call X` anywhere.
- Tool results are fed back as `tool_result` blocks and the next decision is
  made with them in context (`loop.ts:88-107`). A Lease Review turn really does
  `list_documents` → observe → `read_document(id)` → observe → answer. Later
  steps emerge from what was discovered.
- The faithfulness gate is a real, deterministic post-condition on the model's
  output, and it **withholds the answer** on violation rather than shipping it
  (`loop.ts:64-72`). Most "agent" products have no equivalent.
- The audit chain is hash-linked and digest-only — genuinely tamper-evident,
  and it records the gate refusing, not only the times it approved.
- Org scoping is taken from the session and passed to `runTool` as an argument.
  The model cannot name an organization.

### What is only wrapper logic

- The eight agents differ by **a paragraph of prompt text and a list of tool
  names**. That is a persona registry, which is fine, but it is not where
  defensibility lives.
- `routeToPersona` is a keyword scorer, not a planner.
- The "automations" in `app/api/automations/route.ts` are a fixed four-step
  scripted timeline per insight kind (`reported → acknowledged → drafted →
  awaiting approval`). The drafting step is a real model call; the workflow
  around it is predetermined automation, not agent execution.

---

## 3. Gaps preventing Level 4

Ordered by severity.

1. **Tool authorization is not enforced at execution time.** `personaTools()`
   filters the schema list handed to the model. `runTool(name, input, orgId)`
   in `tools.ts:209` then executes **whatever name arrives**, with no check that
   the calling persona was granted it. Today the only thing preventing a Lease
   Review agent from executing `get_delinquent_accounts` is that the tool was
   not offered to it. That is the model enforcing its own permissions — exactly
   the inversion §7 warns against. It matters more here than in a
   single-provider app because `model-router.ts` routes to org-configured
   OpenAI-compatible endpoints and OAuth subscriptions: the tool-call block is
   attacker-adjacent input, not a trusted internal value.
2. **No durable task state.** Everything is in one HTTP request. A worker
   restart mid-analysis loses the run with no record that it started. No
   `QUEUED/RUNNING/WAITING_FOR_*/COMPLETED/FAILED/CANCELLED` lifecycle exists.
3. **No approval gate in the runtime.** The word "approval" appears only as a
   display string in the automations timeline. There is no state a proposed
   action can sit in, no approver identity, no record of a rejection.
4. **No risk classification.** No tool declares whether it mutates, what
   permission it needs, or what it would cost to get it wrong.
5. **No idempotency.** No operation key, no duplicate-suppression table. There
   are no mutating tools today beyond `record_preference` (which is idempotent
   by construction), so this is latent rather than active — but it must exist
   before the first one lands.
6. **Audit coverage is partial.** `answer_audit_log` records `tool_call`,
   `tool_error`, `verdict`, `answer`. It does not record the user, the agent,
   the model/provider, the policy decision, the approval state, retries,
   cancellation, or task lifecycle. §15's field list is roughly half met.
7. **No rate limit on the assistant endpoint.** `lib/security/rate-limit.ts`
   guards signup and login only. The assistant's daily cap is deliberately
   skipped for BYO-credential orgs (`usage.ts:72`, correct reasoning about
   double-billing) — which leaves those orgs with **no request throttle at all**
   on a route that fans out to tool execution and DB reads.
8. **No cancellation.** A long run cannot be stopped.
9. **No retry on tool failure.** A failed tool returns
   `{error: "Tool failed. Do not guess the value."}` and the round is consumed.
   Correct for correctness, wasteful for a transient D1 error.
10. **No delegation.** Risk Analyst cannot ask Lease Review anything.
11. **Prompt-injection defense is instructional, not structural.** The system
    prompt tells the model to treat tool output as data. That is a good and
    necessary line, but there is no deterministic layer that would refuse a
    tool call the injected text talked the model into. Gap 1 is what makes this
    exploitable rather than merely undesirable.

## 4. Gaps preventing Level 5

Level 5 is not currently *applicable* — there is no money movement, no external
send, no destructive operation, no permission mutation anywhere in the tool
surface. Every gap is therefore prospective:

transactional guarantees · reconciliation hooks · duplicate prevention ·
transaction and daily limits · approval thresholds by amount · account
allowlists · currency validation · vendor/invoice matching · external
transaction ID tracking · immutable financial records distinct from the general
audit chain.

The right move is to build the *envelope* now, while the tool surface is
read-only and mistakes are free, so the first financial tool lands inside it.

## 5. Maturity scores

Rubric scores against the checklist in §29 — each sub-item scored 0 (absent),
0.5 (partial), or 1 (present and verified in code), then normalized. These are
rubric assessments, not measurements of running behavior.

| Dimension | Score | Reasoning |
|---|---|---|
| Agentic behavior | **71 / 100** | 5 of 7: dynamic selection ✓, multi-step ✓, observation ✓, replanning ✓, stopping criteria ✓, max-step limit ✓; task state ✗ (in-memory only) |
| Reliability | **22 / 100** | 2 of 9: timeouts ✓, model-call retries ✓(partial); durable state ✗, queue ✗, cancellation ✗, resumability ✗, crash recovery ✗, worker locking ✗, duplicate prevention ✗ |
| Security | **58 / 100** | 7 of 12: authentication ✓, org isolation ✓, resource ownership ✓, secure secrets ✓, input validation ✓, audit logging ✓(partial), file security ✓; deterministic authorization ✗, scoped tool permissions ✗ (schema-level only), rate limiting ✗ (not on this route), prompt injection ✗ (instructional), SSRF ✗ |
| Production readiness | **41 / 100** | Weighted mean over the four §29 sections, with sensitive-actions and financial sections scoring near zero because those layers do not exist |

---

## 6. Prioritized implementation plan

**P0 — close the authorization inversion.** A typed tool registry (permission,
risk class, mutates, allowed agents, timeout, retries, idempotency, approval
requirement) and a deterministic policy engine consulted at the `runTool` call
site. This is the single change that converts "the model decides what it may
do" into "the backend decides". Cheap, and it is the guide's central principle.

**P1 — durable task state.** `agent_tasks` / `agent_task_steps` /
`agent_approvals` tables, the full state machine, step-level persistence,
worker lease + heartbeat so two workers cannot run one task.

**P2 — approvals.** `WAITING_FOR_APPROVAL` as a real state with an approver
identity, an evidence payload, and an audited approve/reject decision.

**P3 — audit completeness.** Extend the existing chain with the missing event
kinds and identity fields, keeping the digest-only discipline.

**P4 — financial safety envelope.** Idempotency keys, transaction limits,
approval thresholds, external transaction IDs — built before the first
mutating financial tool exists.

**P5 — delegation.** Depth caps, allowed pairs, budget propagation,
cancellation propagation, one audit event per hop.

**P6 — execution-trace UI.** Surface the steps that now persist, so the product
shows execution rather than personality selection (§24).

All seven were subsequently built. See `docs/AGENT_RUNTIME.md` for what is
verified by executable tests and what remains unproven.
