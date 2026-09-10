/** Only the root and its server-returned plan nodes may surface approvals in this chat. */
export function approvalsForChat<T extends {taskId:string}>(rootId:string, plan:{nodes:{id:string}[]}|null|undefined, approvals:T[]):T[] {
  const ids = new Set([rootId,...(plan?.nodes??[]).map(node=>node.id)]);
  return approvals.filter(approval=>ids.has(approval.taskId));
}
