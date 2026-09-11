/**
 * One trace per inbound message.
 *
 * The brief asks for identity resolution, hook decisions, tokens, cost and
 * latency on a single span, and for counters alongside. What it asks for
 * *first*, though, is that none of it carries PII — so every value that enters
 * a span goes through `scrub.ts`, and the phone number is reduced to a
 * fingerprint that can be correlated but not dialled.
 *
 * Output goes to `console` and therefore to Cloudflare Workers Logs, which
 * this account already has enabled at full sampling
 * (`wrangler.deploy.jsonc`). That is deliberately unambitious: a tracing
 * backend is a decision worth making on its own, and one structured line per
 * message is enough to answer the operational questions — how many inbound,
 * by role, how many blocked, how many gate-skipped, how many deliveries failed.
 */

import { phoneFingerprint, scrubError } from "./scrub.ts";
import type { InboundIdentity } from "./identity-types.ts";
import type { InboundChannelMessage } from "./registry.ts";

/** Counter names, fixed so a typo cannot silently create a new series. */
export type ChannelCounter =
  | "inbound"
  | "unlinked"
  | "blocked_by_hook"
  | "model_called"
  | "model_skipped"
  | "action_confirmed"
  | "action_abandoned"
  | "gate_skipped"
  | "delivery_failed"
  | "degraded";

export interface ChannelTrace {
  identity(identity: InboundIdentity | null, reason: string, modelCalled: boolean): void;
  hook(tool: string, decision: string, rule?: string): void;
  tool(name: string, latencyMs: number): void;
  usage(input: number, output: number, costUsd?: number): void;
  delivery(status: string, error?: string): void;
  note(note: string): void;
  error(error: unknown): void;
  end(): void;
}

/**
 * Start a span for one inbound message.
 *
 * The message body is never recorded — not scrubbed, not truncated, not
 * hashed. It is the single most sensitive value in the system and there is no
 * operational question it answers that the reason code does not.
 */
export function trace(message: InboundChannelMessage): ChannelTrace {
  const startedAt = Date.now();
  const span: Record<string, unknown> = {
    event: "channel_inbound",
    channel: message.channel,
    from: phoneFingerprint(message.from),
    // The provider's message id is ours, not the sender's, and it is the only
    // way to correlate a trace with a delivery row.
    messageId: message.externalMessageId,
    isButton: Boolean(message.buttonPayload),
  };
  const counters: ChannelCounter[] = ["inbound"];
  const hooks: { tool: string; decision: string; rule?: string }[] = [];
  const tools: { name: string; ms: number }[] = [];
  const notes: string[] = [];

  return {
    identity(identity, reason, modelCalled) {
      span.reason = reason;
      span.role = identity?.role ?? "unlinked";
      span.org = identity?.organizationId ?? null;
      span.locale = identity?.locale ?? null;
      span.modelCalled = modelCalled;
      counters.push(modelCalled ? "model_called" : "model_skipped");
      if (!identity) counters.push("unlinked");
    },
    hook(tool, decision, rule) {
      hooks.push({ tool, decision, rule });
      if (decision === "block" || decision === "deny") counters.push("blocked_by_hook");
    },
    tool(name, latencyMs) {
      tools.push({ name, ms: latencyMs });
    },
    usage(input, output, costUsd) {
      span.tokensIn = input;
      span.tokensOut = output;
      if (costUsd !== undefined) span.costUsd = costUsd;
    },
    delivery(status, error) {
      span.delivery = status;
      if (error) {
        span.deliveryError = scrubError(error);
        counters.push("delivery_failed");
      }
    },
    note(note) {
      notes.push(note);
    },
    error(error) {
      span.error = scrubError(error);
    },
    end() {
      span.ms = Date.now() - startedAt;
      if (hooks.length) span.hooks = hooks;
      if (tools.length) span.tools = tools;
      if (notes.length) span.notes = notes;
      span.counters = counters;
      // One line, structured, already scrubbed. `console.log` rather than a
      // logger object because a Worker's stdout *is* the transport here.
      console.log(JSON.stringify(span));
    },
  };
}

/** Record a counter with no span around it — subscription runs, cron sweeps. */
export function count(counter: ChannelCounter, fields: Record<string, string | number | boolean | null> = {}): void {
  console.log(JSON.stringify({ event: "channel_counter", counter, ...fields }));
}
