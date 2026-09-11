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

import { constantTimeEqual } from "@/lib/security/constant-time";
import { providerJson, record, requiredString, safeSegment } from "@/lib/integrations/http";
import {
  registerChannelAdapter,
  type ChannelAdapter,
  type ChannelSendContext,
  type DeliveryReceipt,
  type InboundChannelMessage,
  type OutboundChannelMessage,
} from "../registry";

const encoder = new TextEncoder();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/**
 * WhatsApp's own limits. The renderer caps well below `maxBodyLength` — the
 * transport's ceiling is not a target.
 */
const CAPABILITIES = {
  buttons: true,
  sessionWindowHours: 24,
  maxBodyLength: 4096,
} as const;

/** Meta caps interactive replies at three buttons and each label at 20 characters. */
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_LABEL = 20;

export async function verifyWhatsappSignature(request: Request, rawBody: string, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret) return false;
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!signature) return false;
  return constantTimeEqual(signature, `sha256=${hex(await hmacSha256(appSecret, rawBody))}`);
}

/**
 * Every real inbound message in a Cloud API payload.
 *
 * Statuses (delivered/read receipts), reactions, and system events are not
 * messages and return nothing — replying to a read receipt would be an
 * infinite loop with a customer's phone on the other end.
 */
export function parseWhatsappPayload(payload: unknown): InboundChannelMessage[] {
  const root = asRecord(payload);
  if (!root) return [];
  const messages: InboundChannelMessage[] = [];

  for (const entry of (root.entry as unknown[] | undefined) ?? []) {
    for (const change of (asRecord(entry)?.changes as unknown[] | undefined) ?? []) {
      const value = asRecord(asRecord(change)?.value);
      if (!value) continue;
      const phoneNumberId = asRecord(value.metadata)?.phone_number_id;
      if (typeof phoneNumberId !== "string") continue;

      // Contacts are listed separately from messages and keyed by wa_id.
      const names = new Map<string, string>();
      for (const contact of (value.contacts as unknown[] | undefined) ?? []) {
        const row = asRecord(contact);
        const name = asRecord(row?.profile)?.name;
        if (typeof row?.wa_id === "string" && typeof name === "string" && name) names.set(row.wa_id, name);
      }

      for (const raw of (value.messages as unknown[] | undefined) ?? []) {
        const message = asRecord(raw);
        if (!message || typeof message.from !== "string") continue;

        const extracted = extractBody(message);
        if (!extracted) continue;

        // Meta sends seconds; everything in this codebase is milliseconds.
        const timestamp = Number(message.timestamp);
        messages.push({
          channel: "whatsapp",
          from: message.from,
          to: phoneNumberId,
          externalMessageId: typeof message.id === "string" ? message.id : crypto.randomUUID(),
          externalThreadId: message.from,
          body: extracted.body,
          buttonPayload: extracted.buttonPayload,
          displayName: names.get(message.from) ?? message.from,
          sentAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date(),
        });
      }
    }
  }

  return messages;
}

/**
 * The text and button payload of one message, or null if it carries neither.
 *
 * Handles the three shapes that matter: plain text, a tap on a reply button,
 * and a selection from a list. An image or a voice note returns null — we do
 * not transcribe or OCR, and pretending to have read one would be worse than
 * saying nothing.
 */
function extractBody(message: Record<string, unknown>): { body: string; buttonPayload?: string } | null {
  const text = asRecord(message.text)?.body;
  if (typeof text === "string" && text.trim()) return { body: text };

  const interactive = asRecord(message.interactive);
  if (interactive) {
    const reply = asRecord(interactive.button_reply) ?? asRecord(interactive.list_reply);
    const id = reply?.id;
    const title = reply?.title;
    if (typeof id === "string") {
      return { body: typeof title === "string" ? title : id, buttonPayload: id };
    }
  }

  // A template quick-reply comes back under `button`, not `interactive`.
  const button = asRecord(message.button);
  if (button && typeof button.payload === "string") {
    return { body: typeof button.text === "string" ? button.text : button.payload, buttonPayload: button.payload };
  }

  return null;
}

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
