# Independence and regional setup — September 8, 2026

## Delivered behavior

- Mode cards align their headings and descriptions at the top regardless of paragraph length. Assisted uses a handshake icon; the checkmark indicates selection only.
- Setup and chat use one three-choice Independence control, backed by the existing revision-checked `/api/preferences` endpoint. The server reads that preference again before mutations.
- A startup briefing names the current mode, explains all three choices, and introduces using Aval. A workspace notice confirms startup and mode changes, then fades and collapses after six seconds. The selector continues to name the active mode. Other tabs refresh after a mode change or when focused.
- Chat has a **Start agent task** action that submits the entered goal and selected agent to the existing durable task engine. Ordinary chat questions still use the analysis flow. Task progress and concrete Yes/No approvals appear directly in chat, as well as Tasks and the Review Center. Chat scopes pending approvals to its root task and server-returned plan nodes before applying the inbox limit.
- Language (English or Latin American Spanish) and region precede PMS selection. Selecting a language switches the remaining onboarding UI after saving that step. Mexico/LatAm prioritize EasyBroker, Tokko Broker, and Wasi; users can show all apps. Saved selections remain visible when changing region. These three regional choices are explicitly labeled as preferences whose connections are not yet implemented.
- Existing stored preferences migrate in memory without dropping the selected mode, revision, or completion state, and an in-progress wizard resumes at the corresponding question.
- The macOS shell uses a visible native title bar. The previous invisible web drag overlay has been removed so it cannot swallow clicks on the mode status.

## Module tutorial and mode examples

Choose **Take a module tour** in **Settings → Preferences**. Seventeen steps visit the overarching modules, with a moving spotlight, pointer, and fast typed explanations. The pointer is a separate overlay next to the highlighted edge. Card placement uses its measured height; narrow windows place it above or below the target so it cannot cover the pointer. Back, Next, close, and Escape are supported; closing restores the prior module. Reduced-motion settings disable movement and reveal text immediately.

Mode examples appear in the independence step of onboarding and in **Settings → Preferences**. Choose a mode, then **Watch example** for a moving cursor and automatic sample decisions, or **Try it yourself** for interactive Yes/No decisions. Pause, resume, and reset are available. The example mode does not change the workspace's saved independence mode. Each sample action appears separately, and the window scrolls to new decisions and results.

Examples, real chat, and the Review Center use the same `AgentApprovalPrompt` component, including the exact action arguments or complete approved plan. Real chat submits decisions to the existing authenticated approval endpoint and polls actual task progress. Example decisions operate only on temporary sample state. No animated click ever approves a real task.

Month abbreviations now remain on one line. The chat task launcher is a nonwrapping button, and the composer reflows at narrow widths. Independence cards remain top-aligned and Assisted uses a handshake.

## Developer validation only

The user-facing **Test independence & agents** module has been removed. Setup has neither the testing module nor the mode examples. The tour launcher is housed in Settings. The startup guide explains where to find it.

Synthetic validation runs from the terminal via `npm run validate:independence`; it does not create a testing surface in the product. The mode examples are illustrations and are not evidence of runtime or model accuracy.

The September 9 live comparison finished with zero successful task completions: all three execution/approval sequences passed, but reviewer timeouts and invalid repair proposals blocked completion. It uses `npm run compare:agents:codex`. See [AGENT_LLM_COMPARISON.md](AGENT_LLM_COMPARISON.md) for the measured results, failed baseline, and limits.

## Current executed validation (0.1.12)

- `npm test` passed: TypeScript, translation parity, production build, **504 unit tests and 145 runtime tests**.
- ESLint passed with zero errors and five existing image warnings.
- **20 desktop tests** and **eight independent synthetic runtime trials** passed.
- DMG integrity, deep code signature and DMG/ZIP SHA-256 verification passed; embedded metadata confirms version 0.1.12 and local port 3010.
- Both language pages return HTTP 200 from the refreshed local server.
- Refreshed native-app inspection confirmed mode examples and the tour launcher in Settings preferences. Full tour interaction was not completed: the app window became unavailable during inspection. Pointer geometry has automated regression coverage.
- The September 9 live comparison exercised all three modes; execution assertions passed but end-to-end completion failed on reviewer timeouts and invalid repair proposals. Failed earlier runs and usage-limit evidence are preserved. No claims of live provider certification are made.

## Earlier executed validation (0.1.10)

- TypeScript check passed.
- English/Spanish translation key parity passed.
- Production build passed. Existing chunk-size, plugin-timing, and middleware deprecation warnings remain.
- ESLint: no errors; five existing image-element warnings.
- `node --test`: **500 passed**.
- `npm run test:runtime`: **143 passed**.
- Desktop tests: **20 passed**.
- Native packaged-app launch and title bar inspected through Computer Use; drag gesture exercised.
- Deep code-signature verification and DMG integrity verification passed.

The new durable-runtime matrix executes the real task loop, SQLite storage, approval decisions, tool executor, adapter request construction, audit trace and completion checks for all three modes and all four messaging-capable built-in agents. It asserts exactly two outbound adapter calls, zero unapproved calls, and the expected two/one/zero approval checkpoints. A separate matrix verifies that all five other built-in agents remain unable to send.

Existing runtime tests additionally cover mode changes before subsequent actions, exact-plan argument changes, duplicate sends, cancelled/expired tasks, revoked membership, missing provider configuration, unknown outcomes, inherited delegation permissions, goal plans, task memory, semantic review plumbing and recovery.

These are synthetic/scripted model and HTTP tests, not live provider certification or a measure of model reasoning accuracy. No live messages or calls were sent as part of this delivery.

## Eight independent runtime trials

Run `npm run validate:independence`. Machine-readable evidence is in [audit/independence-trials.json](audit/independence-trials.json). Each trial starts with a fresh SQLite database, a synthetic property and work order, and a scripted model. The real durable runtime, approval store, policy, adapter request construction, and completion checks execute; HTTP responses remain synthetic.

| Trial | Expected result | Approvals | Adapter calls |
| --- | --- | --- | --- |
| Supervised | Completed after separate Yes decisions | 2 | 2 |
| Assisted | Completed after one exact-plan Yes | 1 | 2 |
| Autonomous | Completed routine work | 0 | 2 |
| Assisted No | Failed unmet delivery goal; zero sends | 1 | 0 |
| Missing connection | Failed; no invented completion | 0 | 0 |
| Unconfirmed response | Failed; recorded unknown, no retry | 0 | 1 |
| Assisted → Supervised | Old plan authority invalidated | 3 | 2 |
| Risk Analyst in Autonomous | Messaging denied by permission ceiling | 0 | 0 |

All eight trials passed their assertions. Failed task states in the negative trials are the correct outcomes, not failed tests. The broader runtime matrix exercises all nine built-in agents across the three modes. New animation tests verify that elapsed time cannot bypass approval gates, changed assisted actions require fresh approval, and completed effects cannot replay.

Native UI inspection confirmed aligned mode cards, the startup introduction, and the rendered module tour. Full interactive visual coverage was limited by concurrent use of the desktop app and unavailable Browser automation; this is not presented as exhaustive visual certification.

## Local installer

`desktop/dist/Aval-0.1.12-local-arm64.dmg` targets **http://127.0.0.1:3010**. It is ad-hoc signed and **not notarized**. ZIP and SHA-256 checksums are alongside it. Production release signing settings remain enabled.

Run `AVAL_LOCAL_PORT=3010 npm run start:local` from the repo when the local server is not already running. Server log for this follow-up: `/tmp/aval-resume-sep9-server.log`.

Regional software references: [EasyBroker API](https://ayuda.easybroker.com/article/330-api-de-easybroker-beta), [Tokko Broker Mexico](https://www.tokkobroker.com/es-mx/), [Wasi](https://wasi.co/softwareinmobiliario/).
