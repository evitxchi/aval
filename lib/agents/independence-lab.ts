/** Isolated rehearsal: production policy + routing, synthetic reads/outbox only.
 * No executor, provider, database or credentials are imported into this module.
 * Durable runtime behavior is separately exercised by the integration suite.
 */
import { evaluate } from './policy.ts';
import { canonicalAction, type AutonomyMode } from './autonomy.ts';
import { routeToPersona } from '../ask-aval/agent-router.ts';
import { PERSONAS, type PersonaId } from '../ask-aval/persona-catalog.ts';

export type LabScenario = 'routine' | 'missing' | 'failure';
export type LabAction = { tool: string; args: Record<string, unknown> };
export type LabState = {
  mode: AutonomyMode; agent: PersonaId; scenario: LabScenario;
  status: 'ready' | 'waiting' | 'completed' | 'blocked' | 'failed' | 'cancelled';
  index: number; approvals: number; approved: string[]; actions: LabAction[];
  outbox: LabAction[]; trace: { event: string; tool?: string; detail?: string }[];
};
const subject = { organizationId: 'synthetic-only', userId: 'synthetic-only', isGuest: false };
export function createLab(mode: AutonomyMode, agent: PersonaId, scenario: LabScenario = 'routine'): LabState {
  const actions = ['Your maintenance request is being reviewed.', 'The maintenance team will follow up here.'].map(body => ({
    tool: 'send_external_message', args: { provider: 'slack', to: 'SYNTHETIC_MAINTENANCE', body },
  }));
  return { mode, agent, scenario, status: 'ready', index: 0, approvals: 0, approved: [], actions, outbox: [], trace: [] };
}
export function advanceLab(input: LabState, command: 'run' | 'approve' | 'cancel', maxActions = Number.POSITIVE_INFINITY): LabState {
  const state = structuredClone(input);
  if (['completed', 'blocked', 'failed', 'cancelled'].includes(state.status)) return state;
  if (command === 'cancel') { state.status = 'cancelled'; state.trace.push({event:'cancelled'}); return state; }
  if (command === 'approve') {
    if (state.status !== 'waiting') return state;
    const pending = state.mode === 'assisted' ? state.actions.slice(state.index) : [state.actions[state.index]];
    state.approved.push(...pending.map(canonicalAction)); state.approvals++;
    state.trace.push({event: state.mode === 'assisted' ? 'planApproved' : 'actionApproved'});
  } else if (state.status === 'waiting') return state;
  if (!state.trace.length) {
    const routed = routeToPersona('Review the maintenance work order and repair request.');
    state.trace.push({event:'routed', detail:routed.personaId});
    const tool = PERSONAS[state.agent].toolNames?.[0] ?? 'get_portfolio_metrics';
    const read = evaluate(tool, {}, subject, {personaId:state.agent, autonomyMode:state.mode});
    state.trace.push({event:read.effect === 'deny' ? 'denied' : 'read', tool});
    if (read.effect === 'deny') { state.status = 'blocked'; return state; }
    if (state.scenario === 'missing') { state.status = 'blocked'; state.trace.push({event:'missing'}); return state; }
  }
  let executed = 0;
  while (state.index < state.actions.length) {
    if (executed >= maxActions) { state.status = 'ready'; return state; }
    const action = state.actions[state.index];
    const approved = state.approved.includes(canonicalAction(action));
    const decision = evaluate(action.tool, action.args, subject, {personaId:state.agent, autonomyMode:state.mode, approvedPlanAction: state.mode === 'assisted' && approved});
    if (decision.effect === 'deny') { state.status = 'blocked'; state.trace.push({event:'denied', tool:action.tool}); return state; }
    if (decision.effect === 'require_approval' && !approved) {
      state.status = 'waiting'; state.trace.push({event:state.mode === 'assisted' ? 'planWaiting' : 'actionWaiting', tool:action.tool}); return state;
    }
    if (state.scenario === 'failure') { state.status = 'failed'; state.trace.push({event:'failed', tool:action.tool}); return state; }
    state.outbox.push(action); state.index++; executed++; state.trace.push({event:'accepted', tool:action.tool});
  }
  // Exercise a sensitive operation against this same agent's actual permission ceiling.
  const sensitive = evaluate('publish_listing', {provider:'meta',body:'Synthetic listing'}, subject, {personaId:state.agent,autonomyMode:state.mode});
  state.trace.push({event:sensitive.effect === 'require_approval' ? 'sensitiveApproval' : sensitive.effect === 'deny' ? 'sensitiveDenied' : 'sensitiveAllowed',tool:'publish_listing'});
  state.status = 'completed'; return state;
}
