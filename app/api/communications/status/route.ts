import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { communicationDeliveries, integrationConnections } from '@/db/schema';
import { connectedAccount } from '@/lib/communications/connection';
import { verifyTwilio } from '@/lib/communications/signature';
export async function POST(request: Request) {
  const id = new URL(request.url).searchParams.get('operation');
  if (!id) return new Response('Not found', { status: 404 });
  const [delivery] = await getDb().select().from(communicationDeliveries).where(eq(communicationDeliveries.id,id)).limit(1);
  if (!delivery) return new Response('Not found', { status: 404 });
  const [connection] = await getDb().select().from(integrationConnections).where(and(eq(integrationConnections.id,delivery.connectionId),eq(integrationConnections.provider,'twilio'))).limit(1);
  if (!connection) return new Response('Not found', { status: 404 });
  const { credentials } = await connectedAccount(delivery.organizationId,'twilio');
  const raw = await request.text();
  if (!(await verifyTwilio(request,raw,credentials.authToken))) return new Response('Invalid signature',{status:401});
  const fields = new URLSearchParams(raw), sid = fields.get('MessageSid') ?? fields.get('CallSid');
  if (fields.get('AccountSid') !== credentials.accountSid || !sid || (delivery.providerId && delivery.providerId !== sid)) return new Response('Invalid account or operation',{status:401});
  const status = fields.get('MessageStatus') ?? fields.get('CallStatus') ?? '';
  const terminal = ['delivered','undelivered','failed','completed','busy','no-answer','canceled'];
  if (['queued','initiated','ringing','in-progress','sent',...terminal].includes(status) && !terminal.includes(delivery.status)) await getDb().update(communicationDeliveries).set({status,providerId:sid,updatedAt:new Date()}).where(and(eq(communicationDeliveries.id,id),eq(communicationDeliveries.status,delivery.status)));
  return new Response(null,{status:204});
}
