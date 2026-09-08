"use client";
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
type PollSource={id:string;provider:string;resourceId:string;error:string|null};
type SourceState={sources:PollSource[];canRefresh:boolean;canManageAutomatic:boolean};
export function ConnectionOperations(){
 const t=useTranslations('ConnectionOperations');
 const [provider,setProvider]=useState('gmail'),[resource,setResource]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [forms,setForms]=useState<{id:string;name:string}[]>([]);
 const [sources,setSources]=useState<PollSource[]>([]);
 const [loaded,setLoaded]=useState(false),[canRefresh,setCanRefresh]=useState(false),[canManageAutomatic,setCanManageAutomatic]=useState(false);
 const loadSources=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch('/api/communications/sync',{cache:'no-store',signal});
  if(!response.ok)throw Error(t('failed'));
  return response.json() as Promise<SourceState>;
 },[t]);
 const applySources=useCallback((data:SourceState)=>{
  setSources(data.sources);setCanRefresh(data.canRefresh);setCanManageAutomatic(data.canManageAutomatic);setLoaded(true);
 },[]);
 useEffect(()=>{const controller=new AbortController();void loadSources(controller.signal).then(data=>{if(!controller.signal.aborted)applySources(data);}).catch(()=>{if(!controller.signal.aborted)setNotice(t('failed'));});return()=>controller.abort();},[loadSources,applySources,t]);
 const [automatic,setAutomatic]=useState(false);
 const [next,setNext]=useState<string|null>(null),[form,setForm]=useState('');
 const run=async(formId?:string,after?:string)=>{
  setBusy(true);setNotice('');
  try{
   const response=await fetch(provider==='meta'?'/api/marketing':'/api/communications/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(provider==='meta'?{formId,after}:{provider,resourceId:resource||undefined,...(automatic?{automatic:true}:{})})});
   const data=await response.json() as {error?:string;forms?:{id:string;name:string}[];imported?:number;next?:string|null};
   if(!response.ok)throw Error(data.error??t('failed'));
   if(data.forms){setForms(current=>after?[...current,...data.forms!]:data.forms!);setNext(data.next??null);setForm('');if(!data.forms.length)setNotice(t('noForms'));}
   else{setNotice(t('imported',{count:data.imported??0}));setNext(data.next??null);setForm(formId??'');}
   if(provider!=='meta'&&automatic)applySources(await loadSources());
  }catch(e){setNotice(e instanceof Error?e.message:t('failed'));}finally{setBusy(false);}
 };
 const stop=async(source:typeof sources[number])=>{
  setBusy(true);setNotice('');
  try{
   const response=await fetch('/api/communications/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:source.provider,resourceId:source.resourceId,automatic:false})});
   if(!response.ok)throw Error(t('failed'));
   setSources(current=>current.filter(s=>s.id!==source.id));
  }catch{setNotice(t('failed'));}finally{setBusy(false);}
 };
 return <details className="communication-settings">
  <summary>{t('title')}</summary><p>{t('description')}</p>
  {!loaded&&!notice&&<p role="status">{t('working')}</p>}
  <fieldset disabled={!loaded||busy}>
   <div className="communication-fields">
    <label>{t('provider')}<select value={provider} onChange={e=>{setProvider(e.target.value);setForms([]);setNext(null);setForm('');setResource('');setNotice('');}}>
     <option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="google_chat">Google Chat</option><option value="microsoft_teams">Microsoft Teams</option><option value="meta">Meta</option>
    </select></label>
    {['google_chat','microsoft_teams'].includes(provider)&&<label>{t('resource')}<input value={resource} onChange={e=>setResource(e.target.value)} placeholder={provider==='google_chat'?'spaces/AAAA':'19:…@thread.v2'}/></label>}
   </div>
   {provider!=='meta'&&<label className="communication-toggle"><input type="checkbox" disabled={!canManageAutomatic} checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/>{t('automatic')}</label>}
   <button type="button" className="soft-button" disabled={provider==='meta'?!canManageAutomatic:!canRefresh} onClick={()=>void run()}>{busy?t('working'):provider==='meta'?t('forms'):t('refresh')}</button>
   {forms.map(f=><p key={f.id}>{f.name} <button type="button" className="soft-button" disabled={!canManageAutomatic} onClick={()=>void run(f.id)}>{t('import')}</button></p>)}
   {next&&<button type="button" className="soft-button" disabled={!canManageAutomatic} onClick={()=>void run(form||undefined,next)}>{t('next')}</button>}
   {sources.map(source=><p key={source.id}>{source.provider} {source.resourceId} · {source.error??t('active')} <button type="button" className="soft-button" disabled={!canManageAutomatic} onClick={()=>void stop(source)}>{t('stop')}</button></p>)}
   {loaded&&sources.length===0&&<p>{t('noSources')}</p>}
  </fieldset>
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
