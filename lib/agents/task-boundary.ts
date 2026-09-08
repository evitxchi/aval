import { getTask } from './tasks';
import { getTool } from './registry';
import { hasPermission, roleForPersona } from './permissions';
import { MAX_DELEGATION_DEPTH } from './policy';
/** Re-read every ancestor: delegation never restores revoked authority or inbound scope. */
export async function taskBoundary(org:string,user:string,taskId:string,toolName:string,args:Record<string,unknown>):Promise<string|null>{
 const tool=getTool(toolName);if(!tool)return null;
 let task=await getTask(org,taskId);const seen=new Set<string>();
 if(!task||task.userId!==user)return 'The task does not belong to this workspace and user.';
 while(task){
  if(seen.has(task.id)||seen.size>MAX_DELEGATION_DEPTH)return 'Invalid or excessive task ancestry.';
  seen.add(task.id);
  if(task.id===taskId&&JSON.parse(task.checkJson??'{}').kind==='plan'&&!['plan_goal','get_goal_plan','read_memory','write_memory','read_task_history'].includes(toolName))return 'A root planner only manages its plan; operational work belongs in checked child tasks.';
  if(['FAILED','COMPLETED','CANCELLED'].includes(task.status))return 'The task or its parent has stopped.';
  if(Date.now()>=(task.deadlineAt?.getTime()??task.createdAt.getTime()+30*60_000))return 'The task or its parent reached its wall-clock limit.';
  if(task.cancelRequested)return 'The task or its parent was cancelled.';
  if(!hasPermission(roleForPersona(task.agentId),tool.requiredPermission))return 'The task ancestry does not grant this tool permission.';
  const scope=JSON.parse(task.executionScopeJson);
  if(scope.source==='inbound'){
   const ownReply=toolName==='send_external_message'&&args.conversation_id===scope.conversationId&&args.to===undefined&&args.provider===undefined;
   const ownRead=toolName==='read_conversation'&&args.conversation_id===scope.conversationId;
   if(!ownReply&&!ownRead&&toolName!=='request_execution_plan')return 'Inbound tasks can only read and reply to their originating conversation.';
  }
  if(!task.parentTaskId)break;
  task=await getTask(org,task.parentTaskId);
  if(!task||task.userId!==user)return 'The parent task is unavailable.';
 }
 return null;
}
