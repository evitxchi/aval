import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { bootRuntime, scriptModel, useTool, conclude, ENV } from './harness.mjs';
registerHooks({resolve(specifier,context,nextResolve){
 return nextResolve(specifier==='next/headers'?'next/headers.js':specifier,context);
}});
async function setup(mode='autonomous') {
 const sqlite=await bootRuntime();
 const {env}=await import('cloudflare:workers');
 Object.assign(env,{INTEGRATION_TOKEN_ENCRYPTION_KEY:'test-only-secret-longer-than-24-characters',AVAL_PUBLIC_URL:'https://aval.test',META_GRAPH_API_VERSION:'v23.0'});
 const {encryptSecret}=await import('../../lib/integrations/crypto.ts');
 const now=Date.now(), encrypted=await encryptSecret('slack-test-token',env.INTEGRATION_TOKEN_ENCRYPTION_KEY);
 sqlite.prepare("INSERT INTO integration_connections (id,organization_id,provider,category,status,auth_mode,access_token_ciphertext,created_by,created_at,updated_at) VALUES ('conn_1','org_1','slack','Communication','connected','oauth2',?,'user_1',?,?)").run(encrypted,now,now);
 const {writeOnboarding}=await import('../../lib/onboarding/storage.ts');
 const {DEFAULT_ONBOARDING}=await import('../../lib/onboarding/preferences.ts');
 await writeOnboarding('user_1','org_1',{...structuredClone(DEFAULT_ONBOARDING),completed:true,preferences:{...structuredClone(DEFAULT_ONBOARDING.preferences),autonomy:[mode]}});
 return {sqlite,env,store:await import('../../lib/communications/store.ts'),tasks:await import('../../lib/agents/tasks.ts'),runtime:await import('../../lib/agents/runtime.ts'),approvals:await import('../../lib/agents/approvals.ts'),executor:await import('../../lib/agents/executor.ts')};
}
const message={provider:'slack',to:'C_TEST',body:'Your maintenance request is being reviewed.'};
const subject={organizationId:'org_1',userId:'user_1',isGuest:false};
async function newTask(tasks,extra={}) {return tasks.createTask({check:{kind:"delivery",operation:"message",status:"accepted"},organizationId:'org_1',userId:'user_1',agentId:'general',goal:'Respond to the maintenance inquiry.',...extra});}
test('delivery model receives specialist evidence tools without expanding its permissions',async()=>{
 for(const agentId of ['maintenance','financial','riskAnalyst']) {
  const {sqlite,tasks,runtime}=await setup();
  try {
   let offered=[];
   globalThis.__MODEL__=async(_env,_org,params)=>{offered=params.tools.map(tool=>tool.name);return conclude('No action taken');};
   const task=await newTask(tasks,{agentId});
   await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId(),{maxStepsThisInvocation:1});
   assert.ok(offered.includes(agentId==='maintenance'?'get_maintenance_performance':'get_accounting_breakdown'));
   assert.equal(offered.includes('send_external_message'),agentId!=='riskAnalyst');
   assert.equal(offered.includes('get_maintenance_performance'),agentId==='maintenance');
   assert.ok(!offered.includes('record_preference'),'delivery reads must not add unrelated mutations');
  }finally{sqlite.close();}
 }
});
test('a real provider send is reserved once, accepted accurately, and scoped by organization',async t=>{
 const {sqlite,store}=await setup();let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(url,'https://slack.com/api/chat.postMessage');assert.equal(init.headers.authorization,'Bearer slack-test-token');assert.equal(JSON.parse(init.body).channel,'C_TEST');return Response.json({ok:true,ts:'171.001'});});
 const first=await store.deliver('org_1',message,'stable-key');assert.equal(first.status,'accepted');
 assert.equal((await store.deliver('org_1',message,'stable-key')).duplicate,true);assert.equal(calls,1);
 await assert.rejects(()=>store.deliver('org_1',{...message,to:'C_OTHER'},'stable-key'),/different request/);
 await assert.rejects(()=>store.deliver('org_public_demo',message,'other'),/Connect and verify/);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM communication_deliveries').get().n,1);
});
test('ambiguous network failures remain unknown and are not sent twice',async t=>{
 const {store}=await setup();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('socket timeout with secret');});
 await assert.rejects(()=>store.deliver('org_1',message,'timeout'),/not confirmed/);
 const replay=await store.deliver('org_1',message,'timeout');assert.equal(replay.status,'unknown');assert.equal(calls,1);
});
test('a callback received before an HTTP timeout preserves its confirmed delivery status',async t=>{
 const {store,sqlite}=await setup();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  sqlite.prepare("UPDATE communication_deliveries SET status='delivered',provider_id='confirmed-id' WHERE request_key='callback-race'").run();
  throw Error('response lost after the callback');
 });
 const result=await store.deliver('org_1',message,'callback-race');
 assert.equal(result.status,'delivered');assert.equal(result.providerId,'confirmed-id');
 const row=sqlite.prepare("SELECT status,error FROM communication_deliveries WHERE request_key='callback-race'").get();
 assert.deepEqual({...row},{status:'delivered',error:null});
 assert.equal((await store.deliver('org_1',message,'callback-race')).duplicate,true);
 assert.equal(calls,1);
});
test('supervised tasks park, show exact content, and resume only after the human decision',async t=>{
 const {tasks,runtime,approvals}=await setup('supervised');let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({ok:true,ts:'171.002'});});
 scriptModel(useTool('send_external_message',message),conclude('Reply submitted'));
 const task=await newTask(tasks);const parked=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());
 assert.equal(parked.status,'WAITING_FOR_APPROVAL');assert.equal(calls,0);
 const approval=await approvals.latestApprovalForTask('org_1',task.id);assert.deepEqual(JSON.parse(approval.evidenceJson).review,message);
 assert.equal((await approvals.decideApproval('org_1',approval.id,'approved','user_1','user_1','owner')).ok,true);
 const done=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());assert.equal(done.status,'COMPLETED');assert.equal(calls,1);
});
test('an approved send cannot execute after its task deadline expires',async t=>{
 const {sqlite,tasks,runtime,approvals}=await setup('supervised');let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({ok:true,ts:'unexpected'});});
 scriptModel(useTool('send_external_message',message),conclude('Reply submitted'));
 const task=await newTask(tasks);assert.equal((await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId())).status,'WAITING_FOR_APPROVAL');
 const approval=await approvals.latestApprovalForTask('org_1',task.id);await approvals.decideApproval('org_1',approval.id,'approved','user_1','user_1','owner');
 sqlite.prepare('UPDATE agent_tasks SET deadline_at=0 WHERE id=?').run(task.id);
 assert.equal((await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId())).status,'FAILED');assert.equal(calls,0);
});
test('delivery checks bind the task, destination, channel, and required delivery status',async t=>{
 const {sqlite,store,tasks}=await setup();const {checkTask}=await import('../../lib/agents/checks.ts');
 const now=Date.now();sqlite.prepare("INSERT INTO conversations (id,organization_id,channel,external_thread_id,contact_display_name,last_message_at,created_at,updated_at) VALUES ('expected','org_1','slack','C_EXPECTED','Resident',?,?,?)").run(now,now,now);
 const task=await newTask(tasks,{check:{kind:'delivery',operation:'message',status:'delivered',conversationId:'expected'}});
 t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,ts:'receipt'}));
 await store.deliver('org_1',{...message,to:'C_OTHER'},task.id+':send');
 sqlite.prepare('UPDATE communication_deliveries SET status=?').run('delivered');
 assert.equal((await checkTask(task,[],0)).exitCode,1);
 sqlite.prepare("UPDATE communication_deliveries SET destination='C_EXPECTED'").run();
 sqlite.prepare("UPDATE integration_connections SET provider='telegram' WHERE id='conn_1'").run();
 assert.equal((await checkTask(task,[],1)).exitCode,1);
 sqlite.prepare("UPDATE communication_deliveries SET status='accepted'").run();
 sqlite.prepare("UPDATE integration_connections SET provider='slack' WHERE id='conn_1'").run();
 assert.equal((await checkTask(task,[],2)).exitCode,1);
 sqlite.prepare("UPDATE communication_deliveries SET status='delivered'").run();
 assert.equal((await checkTask(task,[],3)).exitCode,0);
});
test('assisted mode executes an approved exact plan, refuses changed arguments, and deduplicates repeated sends',async t=>{
 const {tasks,runtime,approvals,executor}=await setup('assisted');let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({ok:true,ts:'171.003'});});
 scriptModel(useTool('request_execution_plan',{summary:'Reply to the maintenance channel.',actions:[{tool:'send_external_message',args:message}]}),useTool('send_external_message',message),conclude('Plan carried out'));
 const task=await newTask(tasks);assert.equal((await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId())).status,'WAITING_FOR_APPROVAL');
 const approval=await approvals.latestApprovalForTask('org_1',task.id);await approvals.decideApproval('org_1',approval.id,'approved','user_1','user_1','owner');
 assert.equal((await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId(),{maxStepsThisInvocation:1})).status,'QUEUED');assert.equal(calls,1);
 const changed=await executor.executeTool({toolName:'send_external_message',args:{...message,to:'C_OTHER'},subject,task:{id:task.id,stepIndex:20}});
 assert.equal(changed.result.status,'needs_approval');
 const repeated=await executor.executeTool({toolName:'send_external_message',args:message,subject,task:{id:task.id,stepIndex:21}});
 assert.equal(repeated.result.status,'ok');assert.equal(repeated.result.json.duplicate,true);assert.equal(calls,1);
 assert.equal((await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId())).status,'COMPLETED');
});
test('autonomous runs routine sends without approval and a mode change takes effect before the next action',async t=>{
 const {tasks,executor,sqlite}=await setup();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({ok:true,ts:'171.004'});});
 const task=await newTask(tasks);
 const request={toolName:'send_external_message',args:message,subject,task:{id:task.id,stepIndex:1}};
 assert.equal((await executor.executeTool(request)).result.status,'ok');
 const prefs=JSON.parse(sqlite.prepare("SELECT preferences FROM user_onboarding WHERE user_id='user_1'").get().preferences);prefs.autonomy=['supervised'];sqlite.prepare("UPDATE user_onboarding SET preferences=?,revision=revision+1 WHERE user_id='user_1'").run(JSON.stringify(prefs));
 assert.equal((await executor.executeTool({...request,task:{id:task.id,stepIndex:2},args:{...message,body:'Another update.'}})).result.status,'needs_approval');assert.equal(calls,1);
});
test('inbound tasks cannot redirect outreach or place calls even in autonomous mode',async()=>{
 const {tasks,executor}=await setup();const task=await newTask(tasks,{executionScope:{source:'inbound',conversationId:'origin-thread'}});
 const request={subject,task:{id:task.id,stepIndex:1}};
 assert.equal((await executor.executeTool({...request,toolName:'send_external_message',args:message})).result.status,'denied');
 assert.equal((await executor.executeTool({...request,toolName:'place_call',args:{to:'+14155550123',script:'Hello'}})).result.status,'denied');
});
test('revoked membership invalidates a queued mutation',async()=>{
 const {tasks,executor,sqlite}=await setup();const task=await newTask(tasks);sqlite.prepare("UPDATE organizations SET owner_user_id='other' WHERE id='org_1'").run();
 assert.equal((await executor.executeTool({toolName:'send_external_message',args:message,subject,task:{id:task.id,stepIndex:1}})).result.status,'denied');
});
test('nested plan schemas reject unknown actions and oversized arrays before approval',async()=>{
 const {tasks,executor}=await setup();const task=await newTask(tasks);
 for(const actions of [[{tool:'issue_payment',args:{}}],Array.from({length:11},()=>({tool:'send_external_message',args:message})),[{tool:'send_external_message',args:{body:22}}]]){
  const result=await executor.executeTool({toolName:'request_execution_plan',args:{summary:'Invalid plan',actions},subject,task:{id:task.id,stepIndex:1}});assert.equal(result.result.status,'denied');
 }
});
test('communication and marketing endpoints reject malformed JSON before reaching a provider',async t=>{
 await setup();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected provider call');});
 const routes=await Promise.all([
  import('../../app/api/conversations/route.ts'),
  import('../../app/api/communications/sync/route.ts'),
  import('../../app/api/marketing/route.ts'),
 ]);
 for(const route of routes){
  for(const body of ['null','[]','"text"','false','{']){
   const response=await route.POST(new Request('https://aval.test/api/test',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'user_1','oai-authenticated-user-email':'owner@example.test'},body}));
   assert.equal(response.status,400);
  }
 }
 assert.equal(calls,0);
});

// Matrix runs the real durable loop, SQLite, approvals, permissions and provider adapter.
// Only the model decisions and HTTP response are scripted; no live messages are sent.
for (const mode of ['supervised','assisted','autonomous']) {
 for (const agentId of ['general','financial','brokerage','maintenance']) {
  test(`${agentId} / ${mode}: two actions complete with the correct human checkpoints`,async t=>{
   const {tasks,runtime,approvals,sqlite}=await setup(mode);let calls=0;
   t.mock.method(globalThis,'fetch',async(url)=>{assert.equal(url,'https://slack.com/api/chat.postMessage');calls++;return Response.json({ok:true,ts:`matrix.${calls}`});});
   const second={...message,body:'The maintenance team will follow up in this channel.'};
   const turns=[useTool('send_external_message',message,'send-first'),useTool('send_external_message',second,'send-second'),conclude('Both updates submitted')];
   if(mode==='assisted')turns.unshift(useTool('request_execution_plan',{summary:'Acknowledge and follow up.',actions:[{tool:'send_external_message',args:message},{tool:'send_external_message',args:second}]},'plan'));
   scriptModel(...turns);
   const task=await newTask(tasks,{agentId});
   let outcome=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());let stops=0;
   while(outcome.status==='WAITING_FOR_APPROVAL'&&stops<3){
    assert.equal(calls,mode==='supervised'?stops:0,'no unapproved action reached the adapter');
    const approval=await approvals.latestApprovalForTask('org_1',task.id);
    assert.equal((await approvals.decideApproval('org_1',approval.id,'approved','user_1','user_1','owner')).ok,true);
    stops++;outcome=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());
   }
   assert.equal(outcome.status,'COMPLETED');assert.equal(calls,2);
   assert.equal(stops,mode==='supervised'?2:mode==='assisted'?1:0);
   assert.equal(sqlite.prepare('SELECT count(*) n FROM communication_deliveries').get().n,2);
   assert.ok((await tasks.listSteps(task.id,'org_1')).some(s=>s.kind==='verification_check'));
  });
 }
 test(`${mode}: independence cannot grant outreach to agents without that permission`,async t=>{
  const {tasks,executor}=await setup(mode);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('A denied tool reached the network');});
  for(const agentId of ['realEstate','marketResearch','riskAnalyst','portfolioOutlook','leaseReview']){
   const task=await newTask(tasks,{agentId});
   const result=await executor.executeTool({toolName:'send_external_message',args:message,subject,context:{personaId:agentId},task:{id:task.id,stepIndex:1}});
   assert.equal(result.result.status,'denied',agentId);
  }
  assert.equal(calls,0);
 });
}
