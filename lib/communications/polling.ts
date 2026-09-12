import { and, eq } from 'drizzle-orm';
import type { DbSession } from "@/db/postgres/session";
import { conversations, messages } from "@/db/postgres/schema";
import { connectedAccount } from './connection';
import { queueInboundTask } from './intake';
import { providerJson, record, requiredString, safeSegment } from '@/lib/integrations/http';
export const POLL_PROVIDERS=['google_chat','microsoft_teams','gmail','outlook'] as const;
type Incoming={id:string;thread:string;name:string;body:string;at:Date};
const rows=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw new Error('The provider returned an invalid message list.');return v;};
function plainMail(part:Record<string,unknown>):string {
  if(part.mimeType==='text/plain' && typeof (part.body as {data?:unknown})?.data==='string'){
    const raw=(part.body as {data:string}).data.replace(/-/g,'+').replace(/_/g,'/');
    return new TextDecoder().decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0))).slice(0,10000);
  }
  return Array.isArray(part.parts)?part.parts.map(p=>plainMail(record(p))).join('\n').slice(0,10000):'';
}
/** A bounded recent-message refresh; reports its window instead of claiming a full mailbox import. */
export async function pollInbox(dbSession: DbSession, org:string,provider:string,resourceId?:string) {
  if(!(POLL_PROVIDERS as readonly string[]).includes(provider))throw new Error('Use the signed webhook for this provider.');
  const {connection,credentials}=await connectedAccount(dbSession, org,provider);
  const headers={authorization:`Bearer ${credentials.accessToken}`};
  const incoming = await dbSession.outsideTransaction(async (): Promise<Incoming[]> => {
    const get=async(path:string)=>record(await providerJson(path,{headers}));
    const incoming:Incoming[]=[];
    if(provider==='google_chat'){
      if(!resourceId||!/^spaces\/[A-Za-z0-9_-]+$/.test(resourceId))throw new Error('Choose a Google Chat space.');
      const data=await get(`https://chat.googleapis.com/v1/${resourceId}/messages?pageSize=25&orderBy=createTime%20desc`);
      for(const value of rows(data.messages??[])){
        const m=record(value),sender=m.sender as {name?:string;displayName?:string;type?:string}|undefined;
        if(sender?.type==='BOT'||sender?.name===`users/${connection.externalAccountId}`||typeof m.text!=='string')continue;
        incoming.push({id:requiredString(m.name),thread:resourceId,name:sender?.displayName??sender?.name??'Google Chat',body:m.text,at:new Date(requiredString(m.createTime))});
      }
    }else if(provider==='microsoft_teams'){
      if(!resourceId)throw new Error('Choose a Microsoft Teams chat ID.');
      const data=await get(`https://graph.microsoft.com/v1.0/chats/${safeSegment(resourceId)}/messages?$top=25`);
      for(const value of rows(data.value)){
        const m=record(value),sender=(m.from as {user?:{id?:string;displayName?:string}})?.user,body=m.body as {content?:string;contentType?:string};
        if(!sender||sender.id===connection.externalAccountId||!body?.content)continue;
        incoming.push({id:requiredString(m.id),thread:resourceId,name:sender.displayName??'Teams contact',body:body.content.replace(/<[^>]*>/g,' ').slice(0,10000),at:new Date(requiredString(m.createdDateTime))});
      }
    }else if(provider==='gmail'){
      const data=await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=in%3Ainbox');
      for(const value of rows(data.messages??[])){
        const m=await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${safeSegment(requiredString(record(value).id))}?format=full`),payload=record(m.payload);
        const fields=rows(payload.headers??[]).map(record),from=fields.find(h=>h.name==='From')?.value;
        if(typeof from!=='string')continue;
        const email=from.match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1];if(!email)continue;
        incoming.push({id:requiredString(m.id),thread:email,name:from,body:plainMail(payload)||String(m.snippet??''),at:new Date(Number(m.internalDate))});
      }
    }else{
      const data=record(await providerJson('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=25&$select=id,from,body,receivedDateTime',{headers:{...headers,Prefer:'outlook.body-content-type="text"'}}));
      for(const value of rows(data.value)){
        const m=record(value),sender=(m.from as {emailAddress?:{address?:string;name?:string}})?.emailAddress,body=(m.body as {content?:string})?.content;
        if(!sender?.address||!body)continue;
        incoming.push({id:requiredString(m.id),thread:sender.address,name:sender.name??sender.address,body,at:new Date(requiredString(m.receivedDateTime))});
      }
    }
    return incoming;
  });
  let imported=0;
  for(const message of incoming.reverse()){
    if(!message.body.trim()||!Number.isFinite(message.at.getTime()))continue;
    const db=dbSession.db,now=new Date();
    await db.insert(conversations).values({id:crypto.randomUUID(),organizationId:org,channel:provider,externalThreadId:message.thread,contactDisplayName:message.name,lastMessageAt:message.at,createdAt:now,updatedAt:now}).onConflictDoNothing();
    const [thread]=await db.select().from(conversations).where(and(eq(conversations.organizationId,org),eq(conversations.channel,provider),eq(conversations.externalThreadId,message.thread))).limit(1);
    if(!thread)continue;
    const inserted=await db.insert(messages).values({id:crypto.randomUUID(),conversationId:thread.id,externalMessageId:message.id,direction:'inbound',body:message.body.slice(0,10000),createdAt:message.at}).onConflictDoNothing().returning({id:messages.id});
    if(inserted.length){
      imported++;
      if(message.at.getTime()>thread.lastMessageAt.getTime())await db.update(conversations).set({lastMessageAt:message.at,updatedAt:now}).where(eq(conversations.id,thread.id));
      // Historical mailbox refreshes should not initiate surprise outreach.
      if(message.at.getTime()>Date.now()-5*60000)await queueInboundTask(dbSession, org,thread.id,message.id,message.body);
    }
  }
  return {imported,window:provider==='gmail'?15:25,complete:false,note:'Refreshed recent messages only. Older mailbox history was not imported.'};
}
