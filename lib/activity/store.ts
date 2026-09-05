import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { workspaceUsage } from "@/db/schema";
export async function recordActivity(
  organizationId: string,
  userId: string,
  now = new Date(),
) {
  const minute = Math.floor(+now / 60000);
  await getDb()
    .insert(workspaceUsage)
    .values({ id: crypto.randomUUID(), organizationId, userId, minute })
    .onConflictDoNothing();
  // Keep a little over a year of minute buckets; no content, keystrokes, or page names are recorded.
  await getDb()
    .delete(workspaceUsage)
    .where(
      and(
        eq(workspaceUsage.organizationId, organizationId),
        eq(workspaceUsage.userId, userId),
        lt(workspaceUsage.minute, minute - 367 * 1440),
      ),
    );
}
export async function readActivity(
  organizationId: string,
  userId: string,
  now = new Date(),
) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const since = new Date(+today - 364 * 86400000);
  const day = sql<string>`strftime('%Y-%m-%d', ${workspaceUsage.minute} * 60, 'unixepoch')`;
  const days = await getDb()
    .select({ date: day, minutes: sql<number>`count(*)` })
    .from(workspaceUsage)
    .where(
      and(
        eq(workspaceUsage.organizationId, organizationId),
        eq(workspaceUsage.userId, userId),
        gte(workspaceUsage.minute, Math.floor(+since / 60000)),
      ),
    )
    .groupBy(day)
    .orderBy(day);
  return {
    today: today.toISOString().slice(0, 10),
    since: since.toISOString().slice(0, 10),
    days,
  };
}
