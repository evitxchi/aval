# Aval resumption — September 7, 2026

## Current delivery

Resumed the interrupted harness audit in this terminal. The local application runs at
**http://127.0.0.1:3010**. Port 3000 belongs to a running KiraLabs project and was preserved.
Restart Aval with `AVAL_LOCAL_PORT=3010 npm run start:local` from this repository.
The local server log is `/tmp/aval-resume-local-server.log`.

The installer is `desktop/dist/Aval-0.1.8-local-arm64.dmg`, with ZIP and
`Aval-0.1.8-local-SHA256SUMS` alongside it. It targets the local server at port 3010,
is ad-hoc signed, and is **not notarized**. Package metadata, application startup,
code signature, disk-image integrity, and SHA-256 checksums pass. Keep the local
server running while using this installer. Production signing requirements are unchanged.

## Changes recovered and completed

- Preserved the prior communications, inbox, calling, marketing, onboarding, and icon work.
- Completed inherited authority, reserved child budgets, mandatory completion contracts,
  independent stored-result checks, and bounded repair feedback.
- Added persisted goal plans, dependencies, finite replanning, shared deadlines, and parent
  access to completed child evidence without accepting invented figures.
- Added append-only task memory, retrieval of evicted history, bounded model context,
  and immutable records of model requests, responses, and completion checks.
- Refused effects from expired/stopped tasks or parents, including approved sends, and
  required terminal database writes to acknowledge the current worker lease.
- Bound delivery success to the task, operation, conversation destination, channel, and
  required receipt status. Provider acceptance cannot prove delivery.
- Exposed plans and checker outcomes in task details in English and Spanish.
- Wired the existing Yardi logo asset into the shared brand renderer.

## Verification

**603 tests pass:** 486 unit/render/desktop tests and 117 runtime integration tests.
TypeScript passes and 1,554 translation keys match. Lint reports zero errors and five
existing image-element warnings. The final production build passes.

Adversarial probes include an actual SIGKILL/restart, 500,000-character context overflow,
false success, repair feedback, failed dependencies, replan/task ceilings, step/token/time
limits, retry exhaustion, forbidden file/network proposals, lost leases, expired approvals,
wrong-destination receipts, and desktop RPC refusals/input limits/timeouts.

Migrations 0029 and 0030 applied successfully to the local D1 database. HTTP smoke tests
pass for English and Spanish pages, task reads, the 64-provider integration catalog,
communication settings and inbox sources, marketing readiness, and specialist recommendations.
No browser interaction or visual testing was performed.

Provider tests use simulated acknowledgements. The local live validator returned
`blocked_no_connected_providers` with zero connected accounts. No customer messages,
calls, or posts were sent during validation.

## Audit outcome and remaining work

Read `AGENT_HARNESS_AUDIT.md` for the full before/after report and individual verdicts.
The audit report is complete; it explicitly retains unclosed findings for broad semantic
success verification, lost-request billing reconciliation, actual upstream desktop sandbox
proof, and matched real-task correctness/latency evaluation. These are not claimed fixed
or accepted out of scope. Passing evidence-access checks does not certify every written
claim or that a model-generated plan fully captures the user's intent.

Peach Software and RM Cloud still need exact vendor identification. Partner-only portals
and other unavailable products listed in `ONBOARDING_AND_CONNECTIONS.md` need their actual
contracts and adapters, beyond API keys. Supported providers still require app approval,
scopes, account setup, public callback configuration, and live validation.

## Hosting

The existing private Sites project is accessible again. The connector verifies owner-only
access, and its source repository was fetched successfully. The validated source and Worker
archive are prepared for private publication to the same project; the terminal delivery
message and native deployment history record its final outcome. Its runtime currently has
the existing integration encryption secret, without company provider credentials. Scheduled
trigger registration on Sites has not been live-verified; local scheduling is enabled.

The separate GitHub/Cloudflare deployment is unchanged. No push to GitHub `main` was made
in this resumption, and its previously reported billing/spending-limit failure was not
rechecked. Scratch helpers in `.local-work/` are retained locally, outside the delivery commits.
