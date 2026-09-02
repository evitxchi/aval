import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import type { ApiIdentity } from "./session";

// Split out from session.ts so that a page-level identity check (which
// doesn't need this) doesn't drag `@/db` — and the Cloudflare D1 binding it
// requires — into paths that only need to know who's asking, not touch the
// database at all.
export async function ensureOrganization(identity: ApiIdentity) {
  const db = getDb();
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, identity.organizationId)).limit(1);
  if (existing) return existing;
  const now = new Date();
  const organization = {
    id: identity.organizationId,
    name: "Aval workspace",
    ownerUserId: identity.userId,
    activeModelProvider: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(organizations).values(organization).onConflictDoNothing();
  return organization;
}
