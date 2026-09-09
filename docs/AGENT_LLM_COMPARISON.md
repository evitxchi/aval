# Agent execution versus an ordinary LLM response

## Current result — September 9, 2026 (Pacific)

The matched live evaluation has finished and **failed end-to-end completion in all three modes**. Execution and approval assertions passed; independent review timed out. Eight separate scripted runtime trials pass. These are different kinds of evidence and must not be conflated.

## September 9 validation result

The fresh [three-mode live comparison](audit/agent-llm-comparison-2026-09-09.json) has finished with **0 of 3 tasks completed successfully**. Codex capacity was available; this run had no usage-limit errors. All three ordinary responses correctly said they could not execute the task. All three Aval tasks read maintenance evidence and made exactly the requested two synthetic adapter calls, in order, with the expected approvals and no duplicates.

| Mode | Ordinary answer latency | Approvals | Adapter calls | Aval runtime | Recorded tokens | Completion |
| --- | --- | --- | --- | --- | --- | --- |
| Supervised | 5.625 s | 2 | 2 | 119.578 s | 136,212 | Failed |
| Assisted | 5.091 s | 1 | 2 | 117.355 s | 152,546 | Failed |
| Autonomous | 5.304 s | 0 | 2 | 113.964 s | 150,475 | Failed |

Every mode then encountered **two independent-review timeouts**, followed by an invalid actor tool proposal during repair. None produced a successful independent verdict or a completed task. The six reviewer calls timed out after 21.012–25.048 seconds under the unchanged runtime/invocation deadlines. The inference bridge rejected the subsequent actor proposals; the recorded error does not distinguish an empty proposal from an oversized proposal, so their exact shape is unknown. The runtime refused completion and did not repeat the sends.

**What this validates:** the current live actor can use maintenance evidence, route the two exact actions, and follow the Supervised/Assisted/Autonomous approval sequence on this synthetic task. The numeric-ID fix allows citations to reach review; the Assisted plan fix consistently uses one approval.

**What failed:** end-to-end task completion with this live Codex transport. Reviewer latency and recovery after unavailable review remain blockers. The script exited with code 2. This is not a passed agentic reliability benchmark, a live Slack test, or proof that Aval reasons better than an equally equipped LLM agent.

The next engineering step is to capture reviewer request/output diagnostics, address completion-review scheduling and latency within explicit task limits, and improve malformed-proposal diagnostics/recovery. Preserve the current failure artifacts and rerun all three modes after that change. Merely increasing an evaluation timeout would be a separate diagnostic, not evidence that the unchanged production limits pass. Recorded token totals exclude calls that timed out or returned an invalid proposal because the bridge did not return their usage.

## Method

`scripts/compare-agent-llm.mjs` uses the same live model (`gpt-6-astra`) and synthetic maintenance facts for an ordinary answer and an Aval Maintenance task in each independence mode. Each trial has a fresh SQLite database, a work order, a seeded conversation, and an encrypted synthetic Slack connection. HTTP is intercepted and asserts exact destination, content, order, no extra sends, and prior approval. No real customer messages are sent.

The ordinary model receives an answer-only schema and no execution tools. Aval receives its actual durable runtime, evidence tools, persisted approvals, adapter code, and completion checks. This compares response-only behavior with execution enabled; it does not establish superior reasoning over an equally equipped agent. Approvals are supplied by the test driver, not a human. Live reviewer calls are required by the runner's success criteria.

The final evaluation fixture uses an explicit 200,000-token task ceiling and a custom-model organization to avoid charging the fixture's free-plan balance. Production limits and provider routing are unchanged. The earlier baseline used the fixture's free-plan metering and cannot support a fair cost comparison.

## Recorded live outcomes before the latest fixes

| Mode | Ordinary response | Aval execution | Outcome |
| --- | --- | --- | --- |
| Supervised | Accurately said it could not read/send; 6.584 s, zero adapter calls | Read maintenance and conversation evidence; two exact adapter calls after two approvals; 29.897 s, 81,059 tokens | Final answer withheld because UUID evidence IDs were parsed as quantities; reviewer not reached |
| Assisted | Accurately said it could not read/send; 4.642 s, zero adapter calls | Read evidence; proposed separate single-action plans; first adapter call accepted, second approval recorded; 35.278 s, 81,191 tokens | Codex usage limit stopped execution; reviewer not reached |
| Autonomous | No new baseline completed | No final-run execution | Codex usage limit |

Times are individual observations, not benchmark estimates; runtime measurements include model calls and automatic test approvals. No successful matched run exists yet. Raw evidence is retained in [the earlier baseline](audit/agent-llm-comparison-baseline.json) and [the final interrupted run](audit/agent-llm-comparison.json).

The earlier baseline exercised all three modes, but all failed completion: it revealed missing maintenance evidence tools, redundant approvals, fixture billing exhaustion, and the citation-number false positive. Synthetic sends in a failed task do not establish successful completion.

## First post-fix live rerun

The [September 8 late-evening rerun](audit/agent-llm-comparison-rerun.json), started at 2026-09-09 05:37:50 UTC, confirmed both corrections in live actor behavior:

- **Supervised:** read maintenance evidence and made exactly two synthetic sends after two approvals. UUID citations reached independent review. Three reviewer calls timed out (25.024, 24.085 and 23.055 seconds); bounded repairs ended the task as failed after 138.237 seconds and 151,355 recorded tokens. No duplicate sends occurred.
- **Assisted:** read evidence and made exactly two synthetic sends after **one** exact-plan approval. Codex capacity was exhausted before the final answer/review. Runtime duration was 37.868 seconds with 89,006 recorded tokens.
- **Autonomous:** could not start its baseline because the account usage limit had been reached.

The ordinary responses correctly reported no execution: 5.690 seconds in Supervised and 4.391 seconds in Assisted. This rerun remains failed, not a successful completion benchmark. Tokens for timed-out requests are not returned by the current inference bridge, so recorded token totals can undercount upstream usage. The scheduled allowance reset was September 9 at 3:20 AM Pacific.

## Corrections and regression evidence

- Delivery tasks retain their specialist's permitted evidence tools. No new specialist permissions are granted.
- Supervised instructions request the actual action, whose execution pauses for approval, without a redundant plan approval.
- The numeric gate excludes only the answer schema's top-level string-array `evidence_ids`. Opaque UUID fragments are not financial quantities. Narrative, document, metric, nested and malformed metadata values remain checked. Row references remain available to independent semantic review; this exclusion does not validate a citation.
- Assisted instructions distinguish one mutating tool call from multiple actions described in a single plan. The approved actions execute one per subsequent turn.

Regression tests verify UUID citations reach independent review, fabricated quantities remain blocked, and all messaging-capable built-in agents execute two actions with the correct two/one/zero approval checkpoints. Other built-in agents remain unable to send. The eight independent scripted trials also cover rejection, a missing connection, an unknown outcome, a mode change, and a restricted agent.

The latest prompt changes and numeric fix have now been exercised with live inference as described above. Completion remains blocked by review failures. Preserve every failed artifact and choose a new output path when rerunning:

```sh
npm run compare:agents:codex -- docs/audit/agent-llm-comparison-next.json
```

A completed rerun must pass every mode, invoke the independent reviewer, preserve failures, and report measured latency and usage. Business-provider certification separately requires real connected accounts and authorized real-world validation. This test has not certified delivery, live provider behavior, hosted model availability, or general agentic reliability.
