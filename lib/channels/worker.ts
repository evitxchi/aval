/**
 * The cron-side drain: where the model call actually happens.
 *
 * Called from `worker/index.ts`'s `scheduled()` handler, on the one-minute
 * cron that already runs. Everything expensive lives here, off the webhook's
 * request path, so Meta's acknowledgement is never waiting on a model.
 *
 * The failure posture throughout is *one message must not poison the queue*.
 * A single event that throws is marked failed and the batch continues; the
 * alternative is one malformed payload stopping replies for every customer.
 */

import { claimInboundEvents, markEvent, readOverflow, storeOverflow } from "./queue.ts";
import { handleInbound } from "./pipeline.ts";
import { askAsIdentity } from "./ask-bridge.ts";
import { sendChannelMessage } from "./outbound.ts";
import { termsFor } from "./vocabulary-store.ts";
import { mayCallModel } from "./budget.ts";
import { budgetFor } from "./budget-store.ts";
import { trace, type ChannelTrace } from "./trace.ts";
import type { AskAvalEnv } from "@/lib/ask-aval/anthropic";
import "./whatsapp/adapter.ts"; // self-registers

export interface ChannelWorkerResult {
  claimed: number;
  replied: number;
  failed: number;
}

/**
 * Drain one batch of inbound channel events.
 *
 * `batchSize` is small on purpose. A Worker invocation has a wall-clock budget
 * and each event may cost a model call; claiming more than can be finished
 * means rows sitting in `processing` until the claim times out, which delays
 * them further rather than less.
 */
export async function runChannelWorker(env: AskAvalEnv, batchSize = 5): Promise<ChannelWorkerResult> {
  const events = await claimInboundEvents(batchSize);
  const result: ChannelWorkerResult = { claimed: events.length, replied: 0, failed: 0 };

  for (const event of events) {
    const span = trace(event.message);
    try {
      const outcome = await handleInbound(event.message, {
        // The budget is checked at the point of the model call rather than at
        // the top of the loop, because most turns never reach one — help, a
        // link code, a button tap and an unlinked number all resolve without
        // spending anything, and none of them should be refused for budget.
        ask: async (input) => {
          const budget = await budgetFor(input.identity.organizationId, env as unknown as Record<string, string | undefined>);
          if (budget.degraded) span.note(`budget:${budget.tier}`);

          if (!mayCallModel(budget.tier)) {
            // Degrade visibly rather than fail silently. The recipient is told
            // the workspace is at its limit and how to raise it — both of the
            // alternatives (an error, or nothing) leave them guessing.
            return { degraded: budget.tier, answer: null, toolsUsed: [] };
          }

          const result = await askAsIdentity({ ...input, env });
          return result ? { ...result, degraded: budget.degraded ? budget.tier : null } : null;
        },
        readOverflow,
        terms: termsFor,
      });

      span.identity(outcome.identity ?? null, outcome.reason, outcome.modelCalled);

      if (outcome.identity) {
        // Held whether or not there is overflow: writing null is what clears a
        // stale tail from the previous answer, so MORE never returns the
        // remainder of a question the user has moved on from.
        await storeOverflow(outcome.identity.channelIdentityId, outcome.identity.organizationId, outcome.overflow ?? null);
      }

      if (outcome.reply && outcome.to) {
        await deliver(event, outcome.reply.body, outcome.reply.buttons, span);
        result.replied += 1;
      }

      await markEvent(event.id, "processed");
    } catch (error) {
      result.failed += 1;
      span.error(error);
      await markEvent(event.id, "failed");
    } finally {
      span.end();
    }
  }

  return result;
}

/**
 * Send a reply for one event.
 *
 * An unlinked sender has no organization, so there is no connection to send
 * through and nothing to charge the send to. That is not an error — it is the
 * expected shape of a message from a stranger — so it is recorded on the trace
 * and dropped rather than thrown.
 *
 * The request key is the inbound message id, which makes the send idempotent
 * against exactly the thing that repeats: a re-claimed event after a worker
 * crash mid-send.
 */
async function deliver(
  event: { id: string; organizationId: string | null; message: { channel: string; from: string } },
  body: string,
  buttons: { id: string; label: string }[],
  span: ChannelTrace,
): Promise<void> {
  const organizationId = event.organizationId;
  if (!organizationId) {
    span.note("no_org_no_send");
    return;
  }

  const sent = await sendChannelMessage({
    organizationId,
    channel: event.message.channel as "whatsapp",
    to: event.message.from,
    body,
    buttons,
    requestKey: `channel:${event.id}`,
  });

  span.delivery(sent.status, sent.error);
}
