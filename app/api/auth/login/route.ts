import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session-cookie";
import { organizationIdForUser } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/security/rate-limit";

// Two independent limits: per-IP (a botnet spreading guesses across many
// accounts) and per-email (many IPs guessing one account) — either alone
// misses one of those two attack shapes.
const LOGIN_IP_RULE = { limit: 30, windowMs: 15 * 60 * 1000 };
const LOGIN_EMAIL_RULE = { limit: 8, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "Email and password are required." }, { status: 400 });

  const ipScope = `login:ip:${clientIp(request)}`;
  const emailScope = `login:email:${email}`;
  if ((await isRateLimited(ipScope, LOGIN_IP_RULE)) || (await isRateLimited(emailScope, LOGIN_EMAIL_RULE))) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  await recordAttempt(ipScope);
  await recordAttempt(emailScope);

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Same message whether the email doesn't exist or the password is wrong —
  // distinguishing the two would let a caller enumerate registered emails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const organizationId = await organizationIdForUser(user.id);
  await ensureOrganization({ userId: user.id, email: user.email, displayName: user.displayName, organizationId, role: "owner", source: "password" });

  const cookie = await createSessionCookie({ userId: user.id, email: user.email, displayName: user.displayName });
  return new Response(JSON.stringify({ email: user.email, displayName: user.displayName }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie, "cache-control": "no-store" },
  });
}
