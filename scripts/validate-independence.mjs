/** Repeatable, isolated runtime trials. Requires tests/integration/module-hooks.mjs.
 * Production runtime, SQLite and adapters; synthetic model/HTTP responses only.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { bootRuntime, scriptModel, useTool as scriptedTool, conclude, ENV } from '../tests/integration/harness.mjs';
registerHooks({resolve(specifier,context,next){return next(specifier==='next/headers'?'next/headers.js':specifier,context);}});
const report={executedAt:new Date().toISOString(),scope:'Real durable runtime, SQLite, tool adapters and approvals. Scripted model/reviewer and HTTP responses; no live provider or reasoning-quality certification.',trials:[]};
const originalFetch=globalThis.fetch;
const message={provider:'slack',to:'SYNTHETIC_MAINTENANCE',body:'Your maintenance request is being reviewed.'};
const second={...message,body:'The maintenance team will follow up here.'};
async function setup(mode,{connected=true}={}){
 const sqlite=await bootRuntime();
 const {env}=await import('cloudflare:workers');
 Object.assign(env,{INTEGRATION_TOKEN_ENCRYPTION_KEY:'synthetic-trial-only-secret-over-24-characters',AVAL_PUBLIC_URL:'https://aval.test'});
 const {encryptSecret}=await import('../lib/integrations/crypto.ts');
 if(connected){const token=await encryptSecret('synthetic-token',env.INTEGRATION_TOKEN_ENCRYPTION_KEY);const now=Date.now();sqlite.prepare("INSERT INTO integration_connections(id,organization_id,provider,category,status,auth_mode,access_token_ciphertext,created_by,created_at,updated_at) VALUES('trial_connection','org_1','slack','Communication','connected','oauth2',?,'user_1',?,?)").run(token,now,now);}
 const prefs=await import('../lib/onboarding/storage.ts');const {DEFAULT_ONBOARDING}=await import('../lib/onboarding/preferences.ts');
 await prefs.writeOnboarding('user_1','org_1',{...structuredClone(DEFAULT_ONBOARDING),completed:true,preferences:{...structuredClone(DEFAULT_ONBOARDING.preferences),autonomy:[mode]}});
 const {createProperty}=await import('../lib/operations/portfolio.ts');const {createWorkOrder}=await import('../lib/operations/maintenance.ts');
 const property=await createProperty('org_1',{name:'Synthetic Harbor Court'});
 await createWorkOrder('org_1',{propertyId:property.id,summary:'Synthetic leaking tap',reportedAt:new Date(Date.now()-3600000)});
 return {sqlite,prefs,tasks:await import('../lib/agents/tasks.ts'),runtime:await import('../lib/agents/runtime.ts'),approvals:await import('../lib/agents/approvals.ts')};
}
async function trial(name,mode,{reject=false,connected=true,unknown=false,switchMode=false,agentId='maintenance',expectedApprovals=mode==='supervised'?2:mode==='assisted'?1:0}={}){
 const started=performance.now();const {sqlite,prefs,tasks,runtime,approvals}=await setup(mode,{connected});let sends=0,stops=0;
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://slack.com/api/chat.postMessage');assert.equal(JSON.parse(init.body).channel,message.to);sends++;if(unknown)throw Error('Synthetic unconfirmed response');return Response.json({ok:true,ts:`synthetic.${sends}`});};
 const task=await tasks.createTask({organizationId:'org_1',userId:'user_1',agentId,goal:'Read the maintenance evidence, acknowledge the request, then follow up.',check:{kind:'delivery',operation:'message',status:'accepted'}});
 const turns=[scriptedTool('get_maintenance_performance',{},'read-source')];
 if(mode==='assisted')turns.push(scriptedTool('request_execution_plan',{summary:'Acknowledge the request and follow up in the same channel.',actions:[{tool:'send_external_message',args:message},{tool:'send_external_message',args:second}]},'exact-plan'));
 if(!reject)turns.push(scriptedTool('send_external_message',message,'first-message'),...(!unknown&&connected?[scriptedTool('send_external_message',second,'second-message')]:[]));
 turns.push(conclude(reject?'Proposal rejected':unknown||!connected?'Unable to confirm the action':'Sample actions accepted'));
 scriptModel(...turns);
 let result=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());
 for(let guard=0;guard<12&&!['COMPLETED','FAILED','CANCELLED'].includes(result.status);guard++){
  if(result.status==='WAITING_FOR_APPROVAL'){
   const approval=await approvals.latestApprovalForTask('org_1',task.id);assert.ok(approval);
   if(stops===0)assert.equal(sends,0,'no send may precede the required review');
   assert.equal((await approvals.decideApproval('org_1',approval.id,reject?'rejected':'approved','user_1','user_1','owner')).ok,true);stops++;
   if(switchMode&&stops===1){const state=await prefs.readOnboarding('user_1','org_1');await prefs.writeOnboarding('user_1','org_1',{...state,preferences:{...state.preferences,autonomy:['supervised']}});}
  }
  result=await runtime.advanceTask(ENV,'org_1',task.id,runtime.newWorkerId());
 }
 const refusedAgent=agentId==='riskAnalyst';const success=!reject&&connected&&!unknown&&!refusedAgent;
 assert.equal(result.status,success?'COMPLETED':'FAILED');
 assert.equal(sends,success?2:unknown?1:0);
 assert.equal(stops,expectedApprovals);
 const steps=await tasks.listSteps(task.id,'org_1');
 assert.ok(steps.some(s=>s.toolName==='get_maintenance_performance'&&s.kind==='tool_call'));
 const deliveries=sqlite.prepare('SELECT status FROM communication_deliveries').all().map(row=>row.status);
 if(success)assert.deepEqual(deliveries,['accepted','accepted']);
 if(unknown)assert.deepEqual(deliveries,['unknown']);
 const evidence={name,mode,agentId,result:'passed',taskStatus:result.status,approvalCheckpoints:stops,adapterCalls:sends,deliveryStates:deliveries,trace:steps.map(s=>({kind:s.kind,tool:s.toolName})),durationMs:Math.round(performance.now()-started)};
 report.trials.push(evidence);console.log(`PASS ${name}: ${result.status}; ${stops} approval checkpoints; ${sends} synthetic adapter calls`);
 sqlite.close();globalThis.fetch=originalFetch;
}
try{
 await trial('Supervised: two separate Yes decisions','supervised');
 await trial('Assisted: one exact-plan Yes decision','assisted');
 await trial('Autonomous: routine work without a Yes decision','autonomous');
 await trial('Assisted: No rejects the plan with zero sends','assisted',{reject:true});
 await trial('Autonomous: missing connection cannot report completion','autonomous',{connected:false});
 await trial('Autonomous: unconfirmed send is never retried','autonomous',{unknown:true});
 await trial('Assisted to Supervised: changed mode invalidates plan authority','assisted',{switchMode:true,expectedApprovals:3});
 await trial('Risk Analyst: autonomy cannot grant messaging permission','autonomous',{agentId:'riskAnalyst',expectedApprovals:0});
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error);process.exitCode=1;console.error(error);}
finally{globalThis.fetch=originalFetch;writeFileSync(process.argv[2]??'docs/audit/independence-trials.json',JSON.stringify(report,null,2)+'\n');}
