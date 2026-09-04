# Aval Agent Runtime

This document records the implemented architecture. Production procedures and
release gates live in `docs/AGENT_PRODUCTION_RUNBOOK.md`.

## Plain-English result

Aval's eight named agents remain one shared runtime with different prompts and
least-privilege tool envelopes. They now behave as durable agents rather than
request-bound chat wrappers: a goal is persisted, the model chooses a next
tool, the backend independently authorizes it, the result is observed, and the
task can replan, yield, recover after a crash, wait for people, delegate within
declared pairs, or terminate.

The system is Level 4 for analytical work. It has selected Level 5 controls for
financial actions, but those actions intentionally remain disabled until Aval
has a real provider executor, organization membership/approver roles, and
business-approved thresholds.

## Components

```text
lib/agents/
  permissions.ts          per-agent capability envelopes
  registry.ts             typed tools: permission, risk, mutation, timeout,
                          retry, idempotency, approval, financial fields
  policy.ts               deterministic execution authorization
  executor.ts             authorize -> approve/reserve -> execute -> audit
  task-state.ts           explicit durable state machine
  tasks.ts                D1 persistence, leases, heartbeat, checkpoints
  runtime.ts              reason -> act -> observe -> replan control loop
  worker.ts               request fast path + scheduled continuation
  retry-policy.ts         bounded task retry/backoff
  approvals.ts            expiring append-only human decisions
  delegation.ts           constrained child tasks
  execution-policy.ts     workspace-owned financial policy
  financial-operations.ts financial journal and reconciliation worker
  reconciliation-rules.ts independent comparison and backoff
  health.ts               org/global operational health snapshots
  monitoring.ts           payload-free incident webhook
```

The Tasks UI renders the persisted execution trace. Browser polling is
strictly observational. `POST` uses Cloudflare `waitUntil` for a fast first
invocation, while the every-minute cron is the source-of-truth continuation
and crash-recovery path.

## Durable states

```text
QUEUED -> RUNNING -> QUEUED                  yielded / retry scheduled
                  -> WAITING_FOR_APPROVAL    lease released
                  -> WAITING_FOR_TOOL        supported; no async tool yet
                  -> COMPLETED
                  -> FAILED
                  -> CANCELLED
```

Every non-terminal state has a terminal path. A terminal state never moves.
Cancellation cascades to children. Leases, not boolean claimed flags, allow a
dead worker's task to recover.

## Security boundary

Tool schemas shown to the model are usability hints, not authority. Every call
is checked again using the authenticated organization/user, the resolved agent
role, the static permission envelope, and the registry descriptor. Retrieved
text is not an input to policy and therefore cannot widen authority.

The same executor protects the existing chat loop and the durable runtime.
Unknown agents narrow to a read-only custom role. Guests cannot mutate the
shared demo workspace. Declared but unwired tools are denied.

## Audit and trace

Each task records ordered model/tool/policy/approval/delegation/error rows with
digests rather than raw sensitive values. Model rows explicitly retain the
resolved provider and model, so later configuration changes do not erase
provenance. The existing organization audit chain records lifecycle, policy,
approval, retry, cancellation, and verdict events.

## Reliability controls

- atomic worker claim with expiring lease;
- heartbeat and lost-lease write protection;
- persisted transcript after every completed reasoning step;
- bounded model/task retry with backoff and jitter;
- descriptor timeouts and read-only retry limits;
- no retry for mutation;
- database-enforced idempotency reservation;
- scheduled stale-approval expiry;
- scheduled independent reconciliation;
- worker-run telemetry, health endpoint, and alert webhook;
- live deployment smoke that proves model + tool + persistence.

## Financial controls

- inactive-by-default owner policy;
- exact integer-cent validation;
- currency and destination allowlists;
- per-transaction and rolling 24-hour caps;
- one- or two-person approval tiers, never automatic;
- approval bound to proposal and policy version;
- immutable financial events and external transaction ids;
- reconciliation lease and independent Stripe transfer retrieval;
- mismatch/reversal/manual-review states;
- unknown outcomes are never blindly retried.

## Verification

The repository currently passes:

- `npm run i18n:check` — 1,028 English and Spanish keys in parity;
- `npm run typecheck`;
- `npm run lint` — zero errors (three pre-existing `<img>` warnings);
- `npm test` — production build plus 410 tests;
- `npm --prefix desktop test` — 20 tests;
- `plutil -lint` on both macOS entitlement files.

The concurrency, recovery, uniqueness, foreign-key, approval, and financial
journal properties execute against SQLite using every generated migration,
not against mocked TypeScript objects. The reservation statement is rendered
from `lib/agents/financial-reservation-sql.ts` and executed, rather than
re-typed in the test: a copy of a statement can only prove that the copy and
the original were written by the same reasoning.

## API

```text
POST   /api/agents/tasks             enqueue and return 202
GET    /api/agents/tasks             recent workspace tasks
GET    /api/agents/tasks/:id         read-only status, result, trace
DELETE /api/agents/tasks/:id         request cancellation
GET    /api/agents/approvals         pending approval evidence
POST   /api/agents/approvals         append approve/reject decision
GET    /api/agents/policy            owner policy state
PUT    /api/agents/policy            owner activates a new policy version
DELETE /api/agents/policy            owner suspends policy
GET    /api/agents/health            owner scope or bearer-auth global scope
```

## Deliberate boundaries

- `WAITING_FOR_TOOL` is modeled but not entered because tools currently finish
  inside an invocation.
- Financial tool descriptors are unwired and fail closed. Infrastructure for
  safe execution is present; money movement is not being claimed.
- There is no organization membership/invitation system yet, so critical
  second-person approval is not operational. Critical execution is therefore
  blocked rather than weakened.
- Vendor-spend reconciliation has no provider adapter and cannot become
  `matched`.

These are release gates, not hidden TODOs. See the runbook's action-enablement
gate before widening authority.
