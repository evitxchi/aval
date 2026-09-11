/**
 * The WhatsApp wire protocol: signature verification and payload parsing.
 *
 * Split from `adapter.ts` because that module reaches `lib/integrations/http.ts`
 * to actually send, and that file uses a TypeScript parameter property which
 * node's strip-only mode rejects — so anything importing it can only run in the
 * integration lane. These two functions are the ones most worth testing fast
 * and often: an HMAC check nobody can run a test against is an HMAC check
 * nobody can trust, and the parser is where a dropped message or a discarded
 * button tap would hide.
 *
 * Both are pure functions of their inputs. Neither touches storage, the
 * network, or the environment.
 */

import { constantTimeEqual } from "../../security/constant-time.ts";
import type { InboundChannelMessage } from "../registry.ts";

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

