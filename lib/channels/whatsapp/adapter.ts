/**
 * The WhatsApp adapter, on Meta's Cloud API.
 *
 * Three things here are load-bearing:
 *
 *  - **Verification runs on raw bytes, before parsing.** An unverified webhook
 *    is an open door into the database, and a JSON parser is the first thing
 *    on the other side of it. `verifyInbound` takes the body as the string it
 *    arrived as.
 *  - **A payload can carry more than one message.** Meta batches. The existing
 *    `parseInboundMessage` in lib/integrations/inbound.ts reads `[0]` and
 *    stops, which is right for its job (drafting one reply in the Inbox) and
 *    wrong for ours: a dropped message in a batch is a question the operator
 *    never gets an answer to.
 *  - **Button taps are messages too.** A reply to an interactive message comes
 *    back with `type: "interactive"` and no `text` field at all, so a parser
 *    keyed on `text.body` silently discards every confirmation. That is the
 *    bug that would make the whole confirm-before-execute flow appear to work
 *    in review and do nothing in production.
 */

import { providerJson, record, requiredString, safeSegment } from "../../integrations/http.ts";
import {
  registerChannelAdapter,
  type ChannelAdapter,
  type ChannelSendContext,
  type DeliveryReceipt,
  type OutboundChannelMessage,
} from "../registry.ts";
import { MAX_BUTTONS, MAX_BUTTON_LABEL, parseWhatsappPayload, verifyWhatsappSignature } from "./protocol.ts";

// One import site for the adapter: callers reach for `adapter.ts` and get the
// protocol functions too, rather than having to know which half of the split a
// given function landed in.
export { MAX_BUTTONS, MAX_BUTTON_LABEL, parseWhatsappPayload, verifyWhatsappSignature } from "./protocol.ts";

/**
 * WhatsApp's own limits. The renderer caps well below `maxBodyLength` — the
 * transport's ceiling is not a target.
 */
const CAPABILITIES = {
  buttons: true,
  sessionWindowHours: 24,
  maxBodyLength: 4096,
} as const;

/**
 * Send a message, with buttons when there are any.
 *
 * Labels are truncated rather than rejected: a button whose text is one
 * character too long should not turn into a failed delivery for the whole
 * answer. Ids are not truncated — a truncated id would match nothing, and
 * silently producing a button that does nothing is worse than sending none.
 */
export async function sendWhatsapp(
  message: OutboundChannelMessage,
  context: ChannelSendContext,
): Promise<DeliveryReceipt> {
  const version = context.config.META_GRAPH_API_VERSION;
  if (!version || !/^v\d+\.\d+$/.test(version)) throw new Error("Configure the Meta Graph API version.");
  const phoneNumberId = context.credentials.phoneNumberId;
  const token = context.credentials.accessToken;
  if (!phoneNumberId || !token) throw new Error("This workspace has no connected WhatsApp number.");

  const buttons = (message.buttons ?? []).slice(0, MAX_BUTTONS);
  const body =
    buttons.length > 0
      ? {
          messaging_product: "whatsapp",
          to: message.to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: message.body },
            action: {
              buttons: buttons.map((button) => ({
                type: "reply",
                reply: { id: button.id, title: button.label.slice(0, MAX_BUTTON_LABEL) },
              })),
            },
          },
        }
      : { messaging_product: "whatsapp", to: message.to, type: "text", text: { body: message.body } };

  try {
    const result = record(
      await providerJson(`https://graph.facebook.com/${version}/${safeSegment(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { providerId: requiredString(record((result.messages as unknown[])?.[0]).id), status: "accepted" };
  } catch (error) {
    // A failed send is a row to retry, not a thrown exception that loses the
    // message. The caller records the failure on the delivery log.
    return { providerId: null, status: "failed", error: error instanceof Error ? error.message : "Send failed" };
  }
}

export const whatsappAdapter: ChannelAdapter = {
  id: "whatsapp",
  verifyInbound: (request, rawBody, config) => verifyWhatsappSignature(request, rawBody, config.META_WHATSAPP_APP_SECRET),
  parseInbound: parseWhatsappPayload,
  send: sendWhatsapp,
  capabilities: CAPABILITIES,
};

registerChannelAdapter(whatsappAdapter);
