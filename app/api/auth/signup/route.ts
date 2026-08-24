import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session-cookie";
import { organizationIdForUser } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAY_NAME_CHARS = 80;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string; displayName?: string };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, MAX_DISPLAY_NAME_CHARS) : email;

  if (!EMAIL_RE.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return Response.json({ error: "An account with that email already exists." }, { status: 409 });

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();
  await db.insert(users).values({ id, email, passwordHash, displayName, createdAt: now, updatedAt: now });

  const organizationId = await organizationIdForUser(id);
  await ensureOrganization({ userId: id, email, displayName, organizationId, source: "password" });

  const cookie = await createSessionCookie({ userId: id, email, displayName });
  return new Response(JSON.stringify({ email, displayName }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie, "cache-control": "no-store" },
  });
}
