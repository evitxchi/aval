import { headers } from "next/headers";
import { readSessionCookie } from "@/lib/auth/session-cookie";
import type { AuthMode } from "@/app/components/auth-gate";
import { IMPLICIT_OWNER_ROLE, type WorkspaceRole } from "@/lib/organizations/roles";

export type ApiIdentity = {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  /**
   * What this user may do in `organizationId`. Resolved per request from
   * membership rather than carried in the session, so revoking access takes
   * effect on the next call instead of when a thirty-day cookie expires.
   */
  role: WorkspaceRole;
  source: AuthMode;
};

/**
 * The workspace every signed-out visitor shares.
 *
 * Deliberately a fixed literal rather than anything derived from the request:
 * a real account's org id is `org_${hash(userId)}`, so this constant cannot
 * collide with one. That is the whole isolation guarantee — open access can
 * never reach a customer's data because it never resolves to a customer's org.
 */
export const PUBLIC_DEMO_ORGANIZATION_ID = "org_public_demo";
export const PUBLIC_DEMO_USER_ID = "public-demo-guest";

/** True when this identity is the shared, signed-out workspace. */
export function isGuestIdentity(identity: Pick<ApiIdentity, "organizationId">): boolean {
  return identity.organizationId === PUBLIC_DEMO_ORGANIZATION_ID;
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function organizationIdForUser(userId: string): Promise<string> {
  return `org_${await digest(userId)}`;
}

export async function getApiIdentity(request: Request): Promise<ApiIdentity | null> {
  // A real customer account (signup/login) takes priority over ChatGPT
  // Sites' platform-injected headers — on a non-Sites deployment there are
  // no such headers at all, so this is the only path real visitors have.
  const sessionUser = await readSessionCookie(request);
  if (sessionUser) {
    const personal = await organizationIdForUser(sessionUser.userId);
    // The cookie says which workspace was chosen; membership decides whether
    // it still counts. A revoked member falls back to their own workspace
    // rather than keeping access until the cookie expires.
    // Dynamic for the same reason session-cookie.ts imports its secret that
    // way: this module is reachable from page rendering, and membership.ts
    // reaches db/index.ts, which statically imports the Workers-only
    // `cloudflare:workers`. A static import there fails to *load* outside a
    // real Workers runtime — before any code runs and with nothing to catch.
    const { resolveMembership } = await import("@/lib/organizations/membership");
    const membership = await resolveMembership(sessionUser.userId, personal, sessionUser.activeOrganizationId);
    return {
      userId: sessionUser.userId,
      email: sessionUser.email,
      displayName: sessionUser.displayName,
      organizationId: membership.organizationId,
      role: membership.role,
      source: "password",
    };
  }

  let hostname = "";
  try { hostname = new URL(request.url).hostname; } catch { /* invalid request URL */ }
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const chatgptUserId = request.headers.get("oai-authenticated-user-id");
  const userId = chatgptUserId ?? (local ? "local-preview" : null);
  const email = request.headers.get("oai-authenticated-user-email") ?? (local ? "preview@aval.local" : null);

  if (!userId || !email) {
    return null;
  }

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName = email;
  if (encodedName) {
    try { displayName = decodeURIComponent(encodedName); } catch { displayName = encodedName; }
  }
  // Platform-injected identity has no session cookie to carry a workspace
  // choice, so it always resolves to its own workspace.
  return {
    userId,
    email,
    displayName,
    organizationId: await organizationIdForUser(userId),
    role: IMPLICIT_OWNER_ROLE,
    source: chatgptUserId ? "chatgpt" : "local",
  };
}

/** Same identity resolution as getApiIdentity, for use in a Server Component page (which gets `headers()`, not a `Request`). */
export async function getPageIdentity(): Promise<ApiIdentity | null> {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost";
  const protocol = headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const request = new Request(`${protocol}://${host}/`, { headers: headersList });
  return getApiIdentity(request);
}
