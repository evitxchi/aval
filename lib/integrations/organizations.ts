import { eq } from "drizzle-orm";
import { upsertMembership } from "@/lib/organizations/membership";
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
    defaultPersonaId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(organizations).values(organization).onConflictDoNothing();
  // The owner gets a membership row too, so a workspace appears in its own
  // owner's switcher and every "who is in this workspace" read has one shape.
  // roleFor still treats organizations.ownerUserId as authoritative, so a
  // workspace created before this table is not locked out by its absence.
  await upsertMembership({ organizationId: identity.organizationId, userId: identity.userId, role: "owner" }).catch(() => {});
  return organization;
}
