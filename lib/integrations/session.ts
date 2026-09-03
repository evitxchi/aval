import { headers } from "next/headers";
import { readSessionCookie } from "@/lib/auth/session-cookie";
import type { AuthMode } from "@/app/components/auth-gate";

export type ApiIdentity = { userId: string; email: string; displayName: string; organizationId: string; source: AuthMode };

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
    return { ...sessionUser, organizationId: await organizationIdForUser(sessionUser.userId), source: "password" };
  }

  let hostname = "";
  try { hostname = new URL(request.url).hostname; } catch { /* invalid request URL */ }
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const chatgptUserId = request.headers.get("oai-authenticated-user-id");
  const userId = chatgptUserId ?? (local ? "local-preview" : null);
  const email = request.headers.get("oai-authenticated-user-email") ?? (local ? "preview@aval.local" : null);

  if (!userId || !email) {
    // Open access: a visitor with no account still reaches the app, in a
    // single shared demo workspace.
    //
    // The org id is a fixed constant, NOT derived from anything about the
    // visitor, which is what keeps this safe: every real account's org id is
    // a hash of its own user id (organizationIdForUser), so no anonymous
    // visitor can ever land in one. They see the demo org and only the demo
    // org, no matter what they do.
    //
    // The tradeoff is inherent to open access rather than a flaw in it: every
    // anonymous visitor shares this one workspace, so anything one of them
    // saves is visible to the next. Surfaces that store third-party content
    // (Documents especially) warn about that — see PUBLIC_DEMO_ORGANIZATION_ID
    // usages.
    return {
      userId: PUBLIC_DEMO_USER_ID,
      email: "guest@aval.app",
      displayName: "Guest",
      organizationId: PUBLIC_DEMO_ORGANIZATION_ID,
      source: "guest",
    };
  }

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName = email;
  if (encodedName) {
    try { displayName = decodeURIComponent(encodedName); } catch { displayName = encodedName; }
  }
  return { userId, email, displayName, organizationId: await organizationIdForUser(userId), source: chatgptUserId ? "chatgpt" : "local" };
}

/** Same identity resolution as getApiIdentity, for use in a Server Component page (which gets `headers()`, not a `Request`). */
export async function getPageIdentity(): Promise<ApiIdentity | null> {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost";
  const protocol = headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const request = new Request(`${protocol}://${host}/`, { headers: headersList });
  return getApiIdentity(request);
}
