import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { integrationConnections, integrationEvents } from '@/db/schema';
import { connectedAccount } from '@/lib/communications/connection';
import { readCommunicationsConfig } from '@/lib/communications/store';
import { voiceResponse } from '@/lib/communications/config';
import { verifyTwilio } from '@/lib/communications/signature';
export async function POST(request: Request) {
  const url = new URL(request.url), id = url.searchParams.get('connection');
  if (!id) return new Response('Unknown connection', { status: 404 });
  const [row] = await getDb().select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.provider, 'twilio'), eq(integrationConnections.status, 'connected'))).limit(1);
  if (!row) return new Response('Unknown connection', { status: 404 });
  const { credentials } = await connectedAccount(row.organizationId, 'twilio');
  const raw = await request.text();
  if (raw.length > 64000 || !(await verifyTwilio(request, raw, credentials.authToken))) return new Response('Invalid signature', { status: 401 });
  const fields = new URLSearchParams(raw);
  if (fields.get('AccountSid') !== credentials.accountSid || !fields.get('CallSid')) return new Response('Invalid account', { status: 401 });
  const speech = (fields.get('SpeechResult') ?? '').slice(0,2000), digit = fields.get('Digits') ?? '', stage = url.searchParams.get('stage') ?? 'entry';
  const config = await readCommunicationsConfig(row.organizationId);
  await getDb().insert(integrationEvents).values({ id: crypto.randomUUID(), provider: 'twilio', externalEventId: `${row.id}:${fields.get('CallSid')}:${stage}:${fields.get('DialCallStatus') ?? ''}`, eventType: 'voice', payloadJson: JSON.stringify({ connectionId: row.id, callId: fields.get('CallSid'), speech, digit, stage, status: fields.get('DialCallStatus') }), status: 'received', receivedAt: new Date() }).onConflictDoNothing();
  return new Response(voiceResponse(config, request.url, speech, digit, fields.get('DialCallStatus') ?? '', stage), { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' } });
}
