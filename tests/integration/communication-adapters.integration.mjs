import assert from 'node:assert/strict';
import test from 'node:test';
import {dispatchMessage,dispatchCall} from '../../lib/communications/providers.ts';
import {publishMetaPost,metaLeadPage} from '../../lib/marketing/providers.ts';

test('every supported message adapter encodes its request and reports acceptance',async t=>{
 const fixtures=[
  ['slack','C_ROOM','slack.com',{ok:true,ts:'message'}],
  ['google_chat','spaces/ROOM','chat.googleapis.com',{name:'spaces/ROOM/messages/message'}],
  ['microsoft_teams','chat:room','graph.microsoft.com',{id:'message'}],
  ['telegram','123','api.telegram.org',{ok:true,result:{message_id:123}}],
  ['whatsapp','+14155550111','graph.facebook.com',{messages:[{id:'message'}]}],
  ['gmail','resident@example.test','gmail.googleapis.com',{id:'message'}],
  ['outlook','resident@example.test','graph.microsoft.com',null],
  ['twilio','+14155550111','api.twilio.com',{sid:'message'}],
 ];
 for(const [provider,to,host,payload] of fixtures){
  let count=0;t.mock.method(globalThis,'fetch',async(url,init)=>{
   count++;assert.equal(new URL(url).hostname,host);assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
   assert.ok(init.signal);assert.ok(String(init.body).length);return payload?Response.json(payload):new Response(null,{status:202});
  });
  const sent=await dispatchMessage({provider,to,body:'Maintenance update: mañana.',subject:'Repair update'},{accessToken:'fixture',botToken:'fixture',phoneNumberId:'phone',accountSid:'ACfixture',authToken:'fixture'},{META_GRAPH_API_VERSION:'v23.0',AVAL_PUBLIC_URL:'https://aval.test'},'operation','+14155550100');
  assert.equal(sent.status,'accepted',provider);assert.equal(count,1,provider);t.mock.restoreAll();
 }
});

test('voice dispatch includes disclosure, escaped script, configured team, and bounded call duration',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(new URL(url).pathname,'/2010-04-01/Accounts/ACfixture/Calls.json');
  const form=new URLSearchParams(init.body);assert.equal(form.get('To'),'+14155550111');assert.equal(form.get('TimeLimit'),'1800');
  assert.match(form.get('Twiml'),/automated assistant/);assert.match(form.get('Twiml'),/Repair &lt;urgent&gt;/);assert.match(form.get('Twiml'),/<Number>\+14155550122<\/Number>/);
  assert.equal(form.get('StatusCallback'),'https://aval.test/callback');return Response.json({sid:'call'});
 });
 assert.equal((await dispatchCall('+14155550111','Repair <urgent>','+14155550100',{accountSid:'ACfixture',authToken:'fixture'},'https://aval.test/callback','+14155550122')).status,'accepted');
});

test('Meta posting and cursor paging stay on the configured Graph endpoint',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;assert.equal(new URL(url).hostname,'graph.facebook.com');assert.equal(init.redirect,'error');
  if(init.method==='POST'){assert.equal(new URL(url).pathname,'/v23.0/page/feed');assert.equal(JSON.parse(init.body).message,'Available home');return Response.json({id:'post'});}
  assert.equal(new URL(url).searchParams.get('after'),'cursor');return Response.json({data:[{id:'lead'}],paging:{next:'https://untrusted.test',cursors:{after:'next-cursor'}}});
 });
 assert.equal((await publishMetaPost('page','Available home','fixture','v23.0')).status,'accepted');
 assert.deepEqual(await metaLeadPage('page','fixture','v23.0','form','cursor'),{items:[{id:'lead'}],next:'next-cursor'});assert.equal(calls,2);
});

test('failed or malformed acknowledgements cannot be promoted to successful sends',async t=>{
 for(const payload of [{ok:false,error:'denied'},{}]){
  t.mock.method(globalThis,'fetch',async()=>Response.json(payload));
  await assert.rejects(()=>dispatchMessage({provider:'slack',to:'C_ROOM',body:'Hello'},{accessToken:'fixture'},{},'operation'));
  t.mock.restoreAll();
 }
});
