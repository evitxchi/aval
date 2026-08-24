import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getApiIdentity } from "@/lib/integrations/session";

/** Real inbound/outbound threads for the signed-in org — populated by app/api/webhooks/[provider]/route.ts as real messages arrive. Empty until a real provider is connected and sends real traffic. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const db = getDb();
  const threads = await db.select().from(conversations).where(eq(conversations.organizationId, identity.organizationId)).orderBy(desc(conversations.lastMessageAt));
  const withMessages = await Promise.all(threads.map(async (thread) => {
    const rows = await db.select().from(messages).where(eq(messages.conversationId, thread.id)).orderBy(asc(messages.createdAt));
    return {
      id: thread.id,
      channel: thread.channel,
      contactDisplayName: thread.contactDisplayName,
      lastMessageAt: thread.lastMessageAt.getTime(),
      draftReply: thread.draftReply,
      draftReplyStatus: thread.draftReplyStatus,
      messages: rows.map((row) => ({ id: row.id, direction: row.direction, body: row.body, createdAt: row.createdAt.getTime() })),
    };
  }));

  return Response.json({ conversations: withMessages }, { headers: { "cache-control": "no-store" } });
}

/** Sends a reply on a real conversation — appends it as an outbound message and clears the pending draft. Persists the record of what was sent; does not itself dispatch anything to a real provider (see the design note in app/api/automations/route.ts for why). */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { conversationId?: string; body?: string };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!body.conversationId || !text) return Response.json({ error: "conversationId and body are required" }, { status: 400 });

  const db = getDb();
  const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), eq(conversations.organizationId, identity.organizationId))).limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });

  const now = new Date();
  await db.insert(messages).values({ id: crypto.randomUUID(), conversationId: conversation.id, externalMessageId: crypto.randomUUID(), direction: "outbound", body: text, createdAt: now });
  await db.update(conversations).set({ draftReply: null, draftReplyStatus: null, lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, conversation.id));

  return Response.json({ ok: true });
}
