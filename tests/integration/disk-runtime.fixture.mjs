import {bootRuntime,conclude,useTool as modelTool,ENV} from './harness.mjs';
const sqlite=await bootRuntime(process.argv[2]);
const tasks=await import('../../lib/agents/tasks.ts');const runtime=await import('../../lib/agents/runtime.ts');
if(process.argv[3]==='start'){
 await tasks.createTask({id:'crash-task',organizationId:'org_1',userId:'user_1',agentId:'general',goal:'Inspect connected channels.',check:{kind:'evidence',tools:['get_communication_channels']}});
 let calls=0;globalThis.__MODEL__=async()=>{if(calls++===0)return modelTool('get_communication_channels');console.log('CHECKPOINTED');await new Promise(()=>{setInterval(()=>{},1000);});};
 await runtime.advanceTask(ENV,'org_1','crash-task',runtime.newWorkerId());
}else{
 const before=await tasks.getTask('org_1','crash-task');sqlite.prepare("UPDATE agent_tasks SET lease_expires_at=0 WHERE id='crash-task'").run();
 let resumedContext=false;globalThis.__MODEL__=async(_e,_o,p)=>{resumedContext=JSON.stringify(p.messages).includes('tool_result');return conclude('Channels inspected');};
 const result=await runtime.advanceTask(ENV,'org_1','crash-task',runtime.newWorkerId());
 console.log(JSON.stringify({priorSteps:before.stepCount,resumedContext,status:result.status,finalSteps:(await tasks.getTask('org_1','crash-task')).stepCount}));
}
