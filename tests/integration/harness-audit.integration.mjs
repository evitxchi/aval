import assert from 'node:assert/strict';
import test from 'node:test';
import {bootRuntime} from './harness.mjs';
test('delegated execution preserves ancestor permissions and reserves a shared budget',async()=>{
 const sqlite=await bootRuntime();const tasks=await import('../../lib/agents/tasks.ts');const {delegate}=await import('../../lib/agents/delegation.ts');const {executeTool}=await import('../../lib/agents/executor.ts');
 const parent=await tasks.createTask({organizationId:'org_1',userId:'user_1',agentId:'riskAnalyst',goal:'Review risks.'});
 const children=[];for(let i=0;i<3;i++){const result=await delegate(parent,'maintenance','Review maintenance');assert.equal(result.ok,true);children.push(result.task);}
 const remaining=await tasks.getTask('org_1',parent.id);
 assert.ok(remaining.maxTokens+children.reduce((n,t)=>n+t.maxTokens,0)<=parent.maxTokens);
 assert.ok(remaining.maxSteps+children.reduce((n,t)=>n+t.maxSteps,0)<=parent.maxSteps);
 const result=await executeTool({toolName:'record_preference',args:{topic:'irrelevant',statement:'irrelevant'},subject:{organizationId:'org_1',userId:'user_1',isGuest:false},context:{personaId:'maintenance'},task:{id:children[0].id,stepIndex:0}});
 assert.equal(result.result.status,'denied');assert.match(result.result.reason,/ancestry/);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM learned_preferences').get().n,0);
});
test('inbound tasks cannot inspect other contacts, portfolio data, or out-of-thread messages',async()=>{
 await bootRuntime();const tasks=await import('../../lib/agents/tasks.ts');const {executeTool}=await import('../../lib/agents/executor.ts');
 const task=await tasks.createTask({organizationId:'org_1',userId:'user_1',agentId:'general',goal:'Review incoming message',executionScope:{source:'inbound',conversationId:'origin'}});
 for(const [toolName,args] of [['list_conversations',{}],['get_delinquent_accounts',{}],['read_conversation',{conversation_id:'elsewhere'}]]){
  const result=await executeTool({toolName,args,subject:{organizationId:'org_1',userId:'user_1',isGuest:false},task:{id:task.id,stepIndex:0}});assert.equal(result.result.status,'denied');
 }
});
