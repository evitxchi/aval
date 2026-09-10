"use client";
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
export type ApprovalDecision = 'approved' | 'rejected';
/** The same concrete review and Yes/No controls appear in chat, Tasks and examples. */
export function AgentApprovalPrompt({tool,review,disabled,onDecision}: {
  tool: string; review: Record<string,unknown>; disabled?: boolean; onDecision: (decision: ApprovalDecision) => void;
}) {
  const t = useTranslations('AgentExperience');
  const actions = tool === 'request_execution_plan' && Array.isArray(review.actions) ? review.actions as {tool:string;args:Record<string,unknown>}[] : [{tool,args:review}];
  return <section className="agent-review-prompt">
    <h4>{t(tool === 'request_execution_plan' ? 'approvePlan' : 'approveAction')}</h4>
    {typeof review.summary === 'string' && <p>{review.summary}</p>}
    <ol>{actions.map((action,index)=><li key={index}>
      <strong>{t.has(`tools.${action.tool}`)?t(`tools.${action.tool}`):action.tool}</strong>
      <dl>{Object.entries(action.args??{}).map(([key,value])=><div key={key}><dt>{t.has(`fields.${key}`)?t(`fields.${key}`):key}</dt><dd>{typeof value==='object'?JSON.stringify(value,null,2):String(value)}</dd></div>)}</dl>
    </li>)}</ol>
    <div className="agent-decision-buttons"><button type="button" data-decision="approved" className="primary-button" disabled={disabled} onClick={()=>onDecision('approved')}><Check size={16}/>{t('yes')}</button><button type="button" data-decision="rejected" className="soft-button" disabled={disabled} onClick={()=>onDecision('rejected')}><X size={16}/>{t('no')}</button></div>
  </section>;
}
