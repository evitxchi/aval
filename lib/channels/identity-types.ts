/**
 * The identity shapes, free of storage imports.
 *
 * Split from `identity.ts` for the reason this repo splits `trace-view.ts`
 * from its component and `redaction.ts` from its callers: `db/index.ts`
 * resolves the D1 binding at module scope, so anything importing it cannot be
 * loaded by a plain `node --test` process. Keeping the types and the pure
 * helpers here means the modules that only need the *shape* of an identity —
 * the registry, the renderer, the hooks — stay in the fast unit lane.
 */

import type { ChannelRole } from "./roles.ts";

/** Channels we can resolve an identity for. Kept in sync with the adapter registry. */
export type ChannelId = "whatsapp" | "sms" | "imessage";

export interface InboundIdentity {
  channelIdentityId: string;
  organizationId: string;
  /** Null for a resident, who is reachable without being a workspace member. */
  userId: string | null;
  /** The `residents` row this number belongs to, when there is one. */
  contactId: string | null;
  channel: ChannelId;
  /** Normalised E.164. The same value the lookup was keyed on. */
  externalId: string;
  role: ChannelRole;
  locale: string;
  /**
   * The tool set this role may reach, resolved at lookup time so the caller
   * cannot forget to narrow it. `null` means every tool the persona offers.
   */
  toolNames: string[] | null;
}

/**
 * The session shape Ask Aval takes, derived from a resolved identity.
 *
 * A helper rather than an inline object literal so there is one place where
 * `orgId` is set from `identity.organizationId`, and no call site where
 * someone could pass a different one.
 */
export function sessionFor(identity: InboundIdentity): { orgId: string; userId: string } {
  // A resident has no user id. `channel:<id>` keeps the actor attributable in
  // the ledger and audit log without inventing a `users` row for someone who
  // is not a member — and it cannot collide with a real user id, which is a
  // bare uuid.
  return { orgId: identity.organizationId, userId: identity.userId ?? `channel:${identity.channelIdentityId}` };
}
