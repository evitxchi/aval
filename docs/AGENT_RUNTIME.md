# Aval Agent Runtime

What was built against `docs/AGENT_ARCHITECTURE_AUDIT.md`, and — as importantly
— what is verified by running code versus what is only structurally sound.

## Layout

```text
lib/agents/
  permissions.ts       Permission type, per-agent envelopes (§17)
  registry.ts          Typed tool registry: risk, permission, timeout,
                       retries, idempotency, approval posture (§9, §10)
  policy.ts            The decision. Deterministic, model-independent (§7)
  financial.ts         Amount/currency validation, thresholds, keys (§11)
  executor.ts          policy → reserve → timeout → retry → audit
  redaction.ts         Argument redaction for logs and approval cards
  task-state.ts        The state machine, storage-free
  tasks.ts             Durable tasks, worker leases, step trace (§13, §14)
  approval-rules.ts    Decision guard: expiry, separation of duties
  approvals.ts         Approval lifecycle (§12)
  delegation-rules.ts  Allowed pairs, depth, budget, intersection (§19)
  delegation.ts        Opening a child task
  runtime.ts           The durable reason → act → observe → replan loop
```

Modules ending in `-rules`, `-state` and `redaction` are deliberately free of
storage imports so they can be unit-tested directly — the same split
`lib/ask-aval/persona-validation.ts` already uses in this repo.

## The change that matters most

Before: `personaTools()` filtered the tool schemas offered to the model, and
`runTool` executed whatever name came back. The model enforced its own
permissions.

Now: every tool call — in the chat loop and in the durable runtime alike —
goes through `executeTool`, which asks `policy.evaluate()` first. That function
takes a tool name, its arguments, a session identity, and two static tables. A
tool result is not one of its inputs and cannot be, so no text an agent reads
can widen what it may do.

## Verified by executable tests

`node --test`, 116 tests across nine agent-runtime files. Every claim below is
asserted by code that runs in CI, not inferred from reading:

| Claim | Where |
|---|---|
| A tool outside an agent's envelope is denied at execution time | `tests/agent-policy.test.ts` |
| Unregistered, malformed and answer-shaped tool names are denied | same |
| Declared-but-unwired tools grant nothing | same |
| An unknown persona id narrows authority rather than widening it | same |
| Persona tool subsets stay inside their permission envelopes | same |
| The widest reader (Risk Analyst) can mutate nothing | same |
| Prompt injection cannot change a policy decision | `tests/agent-injection-redaction.test.ts` |
| Decisions do not vary with argument content | same |
| Free text and nested structures never reach the audit log | same |
| Invalid amounts, scales and currencies are refused | `tests/agent-financial.test.ts` |
| Idempotency keys are stable and derived only from task/step/tool | same |
| No amount executes without a person today | same |
| Terminal tasks cannot move; every state can reach a terminal one | `tests/agent-task-state.test.ts` |
| No mutating tool is ever retried | same |
| **Two workers racing for one task: exactly one wins** | `tests/agent-durability.test.ts` |
| **A crashed worker's task is reclaimed only after its lease expires** | same |
| **A resumed worker continues from the persisted transcript** | same |
| **A worker that lost its lease cannot overwrite the new owner's work** | same |
| **A reserved operation cannot run twice, even with no recorded result** | same |
| Two people deciding one approval produce one decision | same |
| Separation of duties and expiry on approvals | `tests/agent-approvals.test.ts` |
| Delegation narrows permissions and cannot cycle or exceed depth | `tests/agent-delegation.test.ts` |
| One approval authorizes one exact model proposal, not every call with the same tool name | `tests/agent-approval-binding.test.ts` |
| A resumed run rebuilds numeric evidence from its durable transcript | `tests/agent-transcript-evidence.test.ts` |
| A refused call reads as a denial, not as the tool call it was proposed as | `tests/agent-trace-view.test.ts` |
| A trace read back out of order still renders in the order things happened | same |
| The view's terminal-state set cannot drift from the runtime's | same |
| No task state can reach the UI as a raw enum | same |
| Polling advances work after a reload and does not starve runnable work behind an approval | same |

The bolded rows run against real SQLite (`node:sqlite`) using this project's
own generated migrations. D1 is SQLite, so the constraint behaviour is
faithful; the networking is not exercised.

## Not verified end-to-end

**No durable task has been run against a live model.** `advanceTask` is
correct by construction and by unit test, and the module graph builds, but the
full loop — model call, tool execution, persistence, resume — has not been
exercised. `vinext start` cannot serve D1-backed routes locally, so this needs
a deploy to verify. Treat the runtime as unproven until it has run once.

Seven bugs were found and fixed by reading rather than running, which is a fair
indication that more may remain:

1. `messages.pop()` on parking discarded the proposal, so an approved action
   would never have executed — the approval was orphaned.
2. The approval-resume path claimed the lease, then claimed it again; the
   second claim fails its own predicate, so settlement never ran.
3. The idempotency check was a read before the write, leaving the exact window
   §11 describes: a worker that pays and dies before recording leaves no key,
   so the retry pays twice. Now a single atomic reservation.
4. A completed reason/action/observation step was not checkpointed until the
   invocation ended, so a crash could resume from an older transcript. The
   transcript and counters now persist before the next reasoning step.
5. The numeric evidence set existed only in memory. A clean yield or crash
   therefore made a valid final figure look fabricated. It is now rebuilt from
   the persisted tool-result transcript on every invocation.
6. Expired `RUNNING` leases and expired approvals were recoverable in the state
   machine but unreachable through the polling endpoint. Both states now enter
   the runtime through the real production poll path.
7. An approval matched only on tool name, so two same-named calls in one model
   message could share one human decision. It now binds to the exact tool-use
   identifier and fails closed for legacy or malformed evidence.

The runtime also stops if a trace row cannot be persisted. Continuing would
turn a storage failure into an execution the audit falsely says never happened.

## Deliberate limits

- **`WAITING_FOR_TOOL` is supported but never entered.** Tool execution is
  synchronous within a step, so no run parks on a tool. The state exists in the
  machine, the schema and the claim query; nothing reaches it yet. Said plainly
  rather than counted as delivered.
- **Approval thresholds are placeholders.** `AUTOMATIC_MAX_CENTS` is zero, so
  every amount requires a person. The guide is explicit that real values depend
  on Aval's use case, roles, legal position and financial partners. Raising
  them is a business decision.
- **No mutating tool exists beyond `record_preference`.** The gated entries in
  the registry are declared with no executor and denied by policy. They define
  the envelope the first one will land in.
- **Progress is poll-driven.** `POST /api/agents/tasks` runs the first
  invocation; `GET /api/agents/tasks/:id` advances a yielded task. There is no
  scheduled worker on this stack, so a task nobody polls sits claimable — which
  is safe, just not autonomous. The trace view polls every 2.5s while a run is
  live, so a task is only stranded if nobody has the view open.

## Behaviour changes to existing surfaces

- The shared demo workspace (`org_public_demo`) is now read-only to agents.
  Every anonymous visitor is the same subject, so one guest's standing
  preference would have steered the next guest's answers. Reads are unchanged.
- A denied or failed tool is reported back to the model as a tool error rather
  than throwing, so an agent adapts instead of the request failing.
- `answer_audit_log` now also carries policy decisions, model calls, retries,
  approvals and task lifecycle events. The hash serialization is unchanged, so
  every chain already written still verifies.

## API

```text
POST   /api/agents/tasks            { goal, agentId?, maxSteps? } → 202 + first run
GET    /api/agents/tasks            recent tasks for the workspace
GET    /api/agents/tasks/:id        state, result, and the execution trace
                                    (?advance=0 to read without running)
DELETE /api/agents/tasks/:id        request cancellation; cascades to children
GET    /api/agents/approvals        pending actions with their evidence
POST   /api/agents/approvals        { approvalId, decision, note? }
```

The trace returned by `GET /api/agents/tasks/:id` is what the execution UI
renders (§24): per step, the tool, the policy verdict, the risk level, the
attempt count and the duration. `app/components/agent-trace.tsx` consumes it,
mounted in the Tasks view above the scripted automations.

Progress is poll-driven, which the UI is built around rather than hiding: the
detail read is what advances a task that yielded at an invocation boundary, and
expanding a card passes `advance=0` so looking at a run never spends a step.
Polling stops entirely once nothing is live.

## Migration

`drizzle/0016_stiff_shiva.sql` adds `agent_tasks`, `agent_task_steps` and
`agent_approvals`. **Not yet applied to production D1.**
