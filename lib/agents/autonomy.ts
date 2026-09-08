import type { ToolDescriptor } from './registry.ts';
export type AutonomyMode = 'supervised' | 'assisted' | 'autonomous';
export function autonomyMode(value: unknown): AutonomyMode { return value === 'supervised' || value === 'autonomous' ? value : 'assisted'; }
/** These are workflow controls inside the existing permission ceiling. */
export function autonomyApproval(tool: ToolDescriptor, mode: AutonomyMode, planned: boolean): string | null {
  if (tool.name === 'write_memory' || tool.name === 'plan_goal') return null;
  if (tool.name === 'request_execution_plan') return 'Review the proposed agent, evidence, recipients, and exact actions before approving this plan.';
  if (tool.riskLevel === 'critical' || (tool.requiresApproval && !tool.routine)) return 'This sensitive action always requires approval.';
  if (!tool.mutates) return null;
  if (mode === 'supervised') return 'Supervised mode: review this proposed action before Aval executes it.';
  if (mode === 'assisted' && !planned) return 'Assisted mode: approve this action, or ask Aval to propose an execution plan with the exact actions first.';
  return null;
}
export function autonomyInstructions(mode: AutonomyMode): string {
  return `Execution mode: ${mode}. ` + (mode === 'supervised'
    ? 'Investigate using read tools. Recommend the most relevant specialist and explain the evidence. Propose one concrete action at a time for human review.'
    : mode === 'assisted' ? 'Investigate first, then call request_execution_plan with the purpose and exact tool arguments for the actions you intend to take. Wait for approval, then execute those exact actions. A changed action requires a new plan or individual approval.'
    : 'Pursue the goal using evidence and the available specialist tools. Execute routine permitted work without additional check-ins, observe provider results, and revise your approach. Do not repeat unconfirmed sends. Escalate missing data, conflicting evidence, sensitive actions, and provider failures.') + ' Financial policy, workspace permissions, task budgets, and tool permissions always apply. Read connected records before proposing destinations or claims; never invent provider IDs. Provider accepted is not delivered. Call scripts must identify Aval as an automated assistant.';
}

export function canonicalAction(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalAction).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalAction(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
