"use client";
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MousePointer2, Play, Pause, RotateCcw, Hand } from 'lucide-react';
import type { AutonomyMode } from '@/lib/agents/autonomy';
import { advanceLab, createLab } from '@/lib/agents/independence-lab';
import { AgentApprovalPrompt, type ApprovalDecision } from './agent-approval-prompt';
import { AgentTaskWindow } from './agent-task-window';
import { AnimatedCopy } from './animated-copy';

export function ModeExamples() {
  const t=useTranslations('AgentExperience');
  const o=useTranslations('Onboarding');
  const [mode,setMode]=useState<AutonomyMode>('supervised');
  return <section className="panel setup-panel mode-examples"><div className="independence-heading"><h3>{t('examplesTitle')}</h3><span className="status-pill optional">{t('example')}</span></div><p>{t('examplesIntro')}</p>
    <div className="example-mode-tabs" role="group" aria-label={t('exampleMode')}>{(['supervised','assisted','autonomous'] as const).map(id=><button key={id} type="button" aria-pressed={mode===id} onClick={()=>setMode(id)}>{o(`options.${id}`)}</button>)}</div>
    <ExamplePlayer key={mode} mode={mode}/><p className="empty-copy">{t('exampleLimits')}</p>
  </section>;
}
function ExamplePlayer({mode}:{mode:AutonomyMode}) {
  const t=useTranslations('AgentExperience');
  const o=useTranslations('Onboarding');
  const [state,setState]=useState(()=>createLab(mode,'maintenance'));
  const [phase,setPhase]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [interactive,setInteractive]=useState(false);
  const [cursor,setCursor]=useState({x:290,y:260,shown:false,clicking:false});
  const stage=useRef<HTMLDivElement>(null);
  const finished=['completed','cancelled','blocked','failed'].includes(state.status);
  const decide=(decision:ApprovalDecision)=>{setInteractive(true);setState(current=>advanceLab(current,decision==='approved'?'approve':'cancel',1));setCursor(p=>({...p,shown:false}));};
  useEffect(()=>{
    if(!playing||finished)return;
    const timers:ReturnType<typeof setTimeout>[]=[];
    if(phase<2)timers.push(setTimeout(()=>setPhase(n=>n+1),phase===0?300:1200));
    else if(state.status==='ready')timers.push(setTimeout(()=>setState(current=>advanceLab(current,'run',1)),1100));
    else if(state.status==='waiting'&&!interactive){
      const body=stage.current?.querySelector<HTMLElement>('.agent-window-body');
      const button=stage.current?.querySelector<HTMLElement>('[data-decision="approved"]');
      if(body&&button)body.scrollTop=body.scrollHeight;
      const root=stage.current?.getBoundingClientRect(); const rect=button?.getBoundingClientRect();
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(root&&rect&&!reduced){
        timers.push(setTimeout(()=>setCursor({x:rect.left-root.left+rect.width/2,y:rect.top-root.top+rect.height/2,shown:true,clicking:false}),400));
        timers.push(setTimeout(()=>setCursor(p=>({...p,clicking:true})),1200));
      }
      timers.push(setTimeout(()=>{setState(current=>advanceLab(current,'approve',1));setCursor(p=>({...p,shown:false,clicking:false}));},1500));
    }
    return()=>timers.forEach(clearTimeout);
  },[playing,phase,state.status,state.index,interactive,finished]);
  useEffect(()=>{
    if(phase<2)return;
    const body=stage.current?.querySelector<HTMLElement>('.agent-window-body');
    if(body)body.scrollTo({top:body.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  },[phase,state.status,state.outbox.length]);
  const start=(tryIt:boolean)=>{setState(createLab(mode,'maintenance'));setPhase(0);setPlaying(true);setInteractive(tryIt);setCursor({x:290,y:260,shown:false,clicking:false});};
  const status=phase<2?t(phase===0?'ready':'investigating'):state.status==='waiting'?t('statuses.WAITING_FOR_APPROVAL'):state.status==='completed'?t('sampleComplete'):state.status==='cancelled'?t('proposalRejected'):t('statuses.RUNNING');
  return <div className="example-player">
    <div className="example-controls"><button className="soft-button" type="button" onClick={()=>start(false)}><Play size={16}/>{t('watch')}</button><button className="soft-button" type="button" onClick={()=>start(true)}><Hand size={16}/>{t('try')}</button>{playing&&!finished&&<button className="icon-button" type="button" aria-label={t('pause')} onClick={()=>setPlaying(false)}><Pause size={17}/></button>}{!playing&&phase>0&&!finished&&<button className="icon-button" type="button" aria-label={t('resume')} onClick={()=>setPlaying(true)}><Play size={17}/></button>}<button className="icon-button" aria-label={t('reset')} onClick={()=>{setPlaying(false);setPhase(0);setState(createLab(mode,'maintenance'));setCursor(p=>({...p,shown:false}));}}><RotateCcw size={17}/></button></div>
    <div className="example-stage" ref={stage}><AgentTaskWindow title={`Aval · ${o(`options.${mode}`)}`} status={status} sample>
      <p className="agent-window-goal">{t('sampleGoal')}</p>
      {phase===0&&<p className="example-invitation">{t('invitation')}</p>}
      {phase>=1&&<p className="agent-window-message"><AnimatedCopy text={t('sampleRead')}/></p>}
      {phase>=2&&<div className="example-evidence"><span>{t('source')}</span><strong>{t('sampleEvidence')}</strong></div>}
      {state.status==='waiting'&&<AgentApprovalPrompt tool={mode==='assisted'?'request_execution_plan':state.actions[state.index].tool} review={mode==='assisted'?{summary:t('samplePlan'),actions:state.actions.slice(state.index)}:state.actions[state.index].args} disabled={!playing} onDecision={decide}/>}
      {state.outbox.map((action,index)=><p key={index} className="agent-window-message example-result"><strong>{t('accepted',{n:index+1})}</strong><span>{String(action.args.body)}</span></p>)}
      {state.status==='completed'&&<p className="agent-window-message"><AnimatedCopy text={t('sampleResult',{approvals:state.approvals})}/></p>}
      {state.status==='cancelled'&&<p className="agent-window-message">{t('proposalRejected')}</p>}
    </AgentTaskWindow><span aria-hidden="true" className={`example-cursor ${cursor.shown?'shown':''} ${cursor.clicking?'clicking':''}`} style={{left:cursor.x,top:cursor.y}}><MousePointer2 size={25} fill="currentColor"/><i/></span></div>
  </div>;
}
