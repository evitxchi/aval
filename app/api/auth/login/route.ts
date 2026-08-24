import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session-cookie";
import { organizationIdForUser } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "Email and password are required." }, { status: 400 });

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Same message whether the email doesn't exist or the password is wrong —
  // distinguishing the two would let a caller enumerate registered emails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const organizationId = await organizationIdForUser(user.id);
  await ensureOrganization({ userId: user.id, email: user.email, displayName: user.displayName, organizationId, source: "password" });

  const cookie = await createSessionCookie({ userId: user.id, email: user.email, displayName: user.displayName });
  return new Response(JSON.stringify({ email: user.email, displayName: user.displayName }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie, "cache-control": "no-store" },
  });
}
