import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, syncRuns } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: string };
  if (!body.provider) return Response.json({ error: "Provider is required" }, { status: 400 });
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, identity.organizationId), eq(integrationConnections.provider, body.provider))).limit(1);
  if (!connection || connection.status !== "connected") return Response.json({ error: "Provider must be connected before sync" }, { status: 409 });
  const run = { id: crypto.randomUUID(), organizationId: identity.organizationId, connectionId: connection.id, provider: connection.provider, status: "queued", cursorJson: "{}", countsJson: "{}", startedAt: new Date() };
  await db.insert(syncRuns).values(run);
  return Response.json({ run: { id: run.id, provider: run.provider, status: run.status }, note: "Queued for the provider worker; no data is marked fresh until normalization completes." }, { status: 202 });
}
