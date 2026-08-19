import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";

export type ApiIdentity = { userId: string; email: string; displayName: string; organizationId: string };

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getApiIdentity(request: Request): Promise<ApiIdentity | null> {
  let hostname = "";
  try { hostname = new URL(request.url).hostname; } catch { /* invalid request URL */ }
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const userId = request.headers.get("oai-authenticated-user-id") ?? (local ? "local-preview" : null);
  const email = request.headers.get("oai-authenticated-user-email") ?? (local ? "preview@portero.local" : null);
  if (!userId || !email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName = email;
  if (encodedName) {
    try { displayName = decodeURIComponent(encodedName); } catch { displayName = encodedName; }
  }
  return { userId, email, displayName, organizationId: `org_${await digest(userId)}` };
}

export async function ensureOrganization(identity: ApiIdentity) {
  const db = getDb();
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, identity.organizationId)).limit(1);
  if (existing) return existing;
  const now = new Date();
  const organization = {
    id: identity.organizationId,
    name: "Portero workspace",
    ownerUserId: identity.userId,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(organizations).values(organization).onConflictDoNothing();
  return organization;
}
