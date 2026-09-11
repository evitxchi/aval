/**
 * The channel adapter registry.
 *
 * One interface, adapters self-register, and nothing above this layer knows
 * which transport a message arrived on. The point is not that we plan to ship
 * many channels — it is that the agent code must not be able to tell, because
 * the day it can is the day a WhatsApp quirk ends up encoded in a policy
 * decision.
 *
 * Only `whatsapp` is implemented, on the **Meta Cloud API only**. The QR-paired
 * alternatives (WAHA, Baileys, whatsapp-web.js) are excluded on purpose: they
 * drive WhatsApp Web from a companion device, which requires throttling,
 * jitter and send-window heuristics to avoid a ban, and the failure mode is a
 * customer's actual business number being cut off. A transport that needs
 * anti-ban logic to survive is a transport that is not permitted to be there.
 * `lib/integrations/catalog.ts` carries a `whatsapp_personal` entry for that
 * path; agent traffic must never be routed through it.
 *
 * iMessage is deliberately not implemented. `sms` and `imessage` exist in the
 * type union so the interface is proven to generalise — see
 * `tests/channel-registry.test.ts`, which registers a second adapter and
 * asserts the agent path needs no change to reach it.
 */

import type { ChannelId } from "./identity-types.ts";

/** A message that has arrived, after signature verification and parsing. */
export interface InboundChannelMessage {
  channel: ChannelId;
  /** The sender, raw from the provider. Normalised downstream, never trusted. */
  from: string;
  /** The business number or account the message was sent *to*. Resolves the connection. */
  to: string;
  /** Provider message id. The idempotency key. */
  externalMessageId: string;
  /** The thread this belongs to. For WhatsApp, the sender's number. */
  externalThreadId: string;
  /** Attacker-controlled. Never interpolated into a prompt as an instruction. */
  body: string;
  /** Set when the message is a tap on one of our own reply buttons. */
  buttonPayload?: string;
  /** The provider's display name for the sender. Also attacker-controlled. */
  displayName: string;
  sentAt: Date;
}

/** A message we want to send. */
export interface OutboundChannelMessage {
  channel: ChannelId;
  to: string;
  body: string;
  /**
   * Up to three quick-reply buttons. The adapter is responsible for degrading
   * gracefully when its transport has no button support — an SMS adapter
   * renders them as numbered text rather than dropping them, because the
   * buttons are how the command set is discovered.
   */
  buttons?: ChannelButton[];
}

export interface ChannelButton {
  /** What the recipient sees. WhatsApp caps this at 20 characters. */
  label: string;
  /**
   * Opaque, server-issued. Carries an id and nothing else — never arguments,
   * never an org, never a role. A crafted payload can at most select an action
   * the backend already composed and stored; it cannot compose one.
   */
  id: string;
}

export interface DeliveryReceipt {
  /** The provider's id for the sent message, when it gave one. */
  providerId: string | null;
  status: "accepted" | "failed";
  error?: string;
}

export interface ChannelCapabilities {
  buttons: boolean;
  /**
   * Hours after a user's last inbound message during which free-form replies
   * are allowed. `null` means the transport has no such window.
   *
   * WhatsApp's is 24. Outside it, only Meta-approved templates may be sent,
   * which is why `docs/WA_TEMPLATES.md` is on the critical path — each locale
   * variant is approved separately and approval takes days.
   */
  sessionWindowHours: number | null;
  /** Longest body the transport accepts, before our own tighter render cap. */
  maxBodyLength: number;
}

export interface ChannelAdapter {
  id: ChannelId;
  /**
   * Verify an inbound request is genuinely from the provider.
   *
   * Takes the raw body as a string alongside the request, because verification
   * must happen on the exact bytes received and **before** parsing. Handing
   * this a parsed object would mean the JSON parser ran on unverified input.
   *
   * `config` is passed in rather than read from the module environment so this
   * is a pure function of its inputs and can be tested with a known secret —
   * an HMAC check nobody can run a test against is an HMAC check nobody can
   * trust.
   */
  verifyInbound(request: Request, rawBody: string, config: Record<string, string | undefined>): Promise<boolean>;
  /** Parse a verified payload. Returns every message it contains; a payload with none returns []. */
  parseInbound(payload: unknown): InboundChannelMessage[];
  send(message: OutboundChannelMessage, context: ChannelSendContext): Promise<DeliveryReceipt>;
  capabilities: ChannelCapabilities;
}

/** What an adapter needs to actually reach the provider, resolved per organization. */
export interface ChannelSendContext {
  credentials: Record<string, string>;
  config: Record<string, string | undefined>;
  /** Idempotency key, so a retried send is not a second message. */
  operationId: string;
}

const ADAPTERS = new Map<ChannelId, ChannelAdapter>();

/**
 * Register an adapter.
 *
 * Idempotent by id — re-registering replaces, so a module evaluated twice (a
 * real possibility across Worker isolates and test runs) does not throw. It
 * is a lookup table, not a lifecycle.
 */
export function registerChannelAdapter(adapter: ChannelAdapter): void {
  ADAPTERS.set(adapter.id, adapter);
}

export function getChannelAdapter(id: string): ChannelAdapter | null {
  return ADAPTERS.get(id as ChannelId) ?? null;
}

export function registeredChannels(): ChannelId[] {
  return [...ADAPTERS.keys()];
}

/** Test seam. Never called in production. */
export function resetChannelAdapters(): void {
  ADAPTERS.clear();
}
