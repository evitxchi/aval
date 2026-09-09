# Agent execution versus an ordinary LLM response

## Result as of September 8, 2026 (Pacific)

The matched live evaluation is **incomplete, not passed**. It exposed defects and then exhausted the connected Codex account's usage allowance. Eight separate scripted runtime trials pass. These are different kinds of evidence and must not be conflated.

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

## Corrections and regression evidence

- Delivery tasks retain their specialist's permitted evidence tools. No new specialist permissions are granted.
- Supervised instructions request the actual action, whose execution pauses for approval, without a redundant plan approval.
- The numeric gate excludes only the answer schema's top-level string-array `evidence_ids`. Opaque UUID fragments are not financial quantities. Narrative, document, metric, nested and malformed metadata values remain checked. Row references remain available to independent semantic review; this exclusion does not validate a citation.
- Assisted instructions distinguish one mutating tool call from multiple actions described in a single plan. The approved actions execute one per subsequent turn.

Regression tests verify UUID citations reach independent review, fabricated quantities remain blocked, and all messaging-capable built-in agents execute two actions with the correct two/one/zero approval checkpoints. Other built-in agents remain unable to send. The eight independent scripted trials also cover rejection, a missing connection, an unknown outcome, a mode change, and a restricted agent.

The latest prompt changes and numeric fix have **not** been revalidated with live inference. The recorded allowance error says to retry after September 9, 2026, 3:02 AM Pacific, or after account capacity is restored. Do not overwrite either failed artifact when rerunning:

```sh
npm run compare:agents:codex -- docs/audit/agent-llm-comparison-rerun.json
```

A completed rerun must pass every mode, invoke the independent reviewer, preserve failures, and report measured latency and usage. Business-provider certification separately requires real connected accounts and authorized real-world validation. This test has not certified delivery, live provider behavior, hosted model availability, or general agentic reliability.
