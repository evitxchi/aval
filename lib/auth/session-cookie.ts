/**
 * Self-contained, signed session cookie for real customer accounts
 * (deployments outside ChatGPT Sites, where there's no platform-injected
 * identity header). The cookie carries the user's identity plus an
 * expiry, HMAC-signed with SESSION_SECRET — verified per request without a
 * database round trip. Trade-off: a compromised secret or a session token
 * can't be revoked before it expires; acceptable for now, revisit with a
 * server-side session table if that's ever needed.
 */

const COOKIE_NAME = "aval_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
}

// Dynamic, not a top-level `import ... from "cloudflare:workers"` — this
// module is reachable from page rendering (via getPageIdentity), and a
// static import of a Workers-only virtual module fails outside a real
// Workers/Miniflare runtime (e.g. the plain-Node test harness) before this
// function ever runs. A dynamic import's rejection is catchable; a static
// import's is not.
async function getSecret(): Promise<string> {
  const cloudflareWorkers = await import("cloudflare:workers").catch(() => null);
  const secret = (cloudflareWorkers?.env as unknown as { SESSION_SECRET?: string } | undefined)?.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function createSessionCookie(user: SessionUser): Promise<string> {
  const secret = await getSecret();
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...user, exp })));
  const signature = await hmacSign(body, secret);
  return `${COOKIE_NAME}=${body}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Parses and verifies the session cookie on a request. Fails closed — any error (bad signature, expired, missing secret) reads as "no session," never a crash. */
export async function readSessionCookie(request: Request): Promise<SessionUser | null> {
  try {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (!match) return null;
    const [body, signature] = match[1].split(".");
    if (!body || !signature) return null;
    const expected = await hmacSign(body, await getSecret());
    if (expected !== signature) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionUser & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { userId: payload.userId, email: payload.email, displayName: payload.displayName };
  } catch {
    return null;
  }
}
