"use client";
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_COMMUNICATIONS, type CommunicationsConfig } from '@/lib/communications/config';
import { BrandMark } from './brand-mark';
export function CommunicationSettings() {
  const t = useTranslations('Communications');
  const [config,setConfig] = useState<CommunicationsConfig>(DEFAULT_COMMUNICATIONS);
  const [loaded,setLoaded] = useState(false), [canEdit,setCanEdit] = useState(false), [busy,setBusy] = useState(false), [notice,setNotice] = useState('');
  const [webhooks,setWebhooks] = useState<{voice:string|null;sms:string|null}>({voice:null,sms:null});
  const [deliveries,setDeliveries] = useState<{id:string;kind:string;status:string;error:string|null}[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/communications/settings',{cache:'no-store',signal:controller.signal}).then(async r => { if (!r.ok) throw Error(t('loadError')); return r.json() as Promise<{config:CommunicationsConfig;canEdit:boolean;deliveries:{id:string;kind:string;status:string;error:string|null}[];voiceWebhook:string|null;smsWebhook:string|null}>; }).then(data => {setConfig(data.config);setCanEdit(data.canEdit);setDeliveries(data.deliveries);setWebhooks({voice:data.voiceWebhook,sms:data.smsWebhook});setLoaded(true);}).catch(e => {if (!controller.signal.aborted) setNotice(e.message);});
    return () => controller.abort();
  },[t]);
  const save = async () => {
    setBusy(true);setNotice('');
    try {
      const response = await fetch('/api/communications/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(config)});
      const data = await response.json() as {config:CommunicationsConfig;error?:string}; if (!response.ok) throw Error(data.error ?? t('saveError')); setConfig(data.config);setNotice(t('saved'));
    } catch(e) {setNotice(e instanceof Error ? e.message : t('saveError'));} finally {setBusy(false);}
  };
  return <details className="communication-settings"><summary><BrandMark provider="twilio" small/>{t('title')}</summary><p>{t('description')}</p>
    {notice && <p role="status">{notice}</p>}
    {!loaded && !notice && <p role="status">{t('loading')}</p>}
    {loaded && <fieldset disabled={!canEdit || busy}>
      <label className="communication-toggle"><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/>{t('enabled')}</label>
      <div className="communication-fields"><label>{t('from')}<input value={config.fromNumber} placeholder="+14155550100" onChange={e=>setConfig({...config,fromNumber:e.target.value})}/></label><label>{t('fallback')}<input value={config.fallbackNumber} placeholder="+14155550101" onChange={e=>setConfig({...config,fallbackNumber:e.target.value})}/></label></div>
      <label>{t('greeting')}<textarea value={config.greeting} maxLength={600} onChange={e=>setConfig({...config,greeting:e.target.value})}/></label>
      {config.routes.map((route,index)=><div className="communication-route" key={route.id}><span>{index+1}</span><label>{t('team')}<input value={route.label} onChange={e=>setConfig({...config,routes:config.routes.map(r=>r.id===route.id?{...r,label:e.target.value}:r)})}/></label><label>{t('number')}<input value={route.phone} placeholder="+14155550102" onChange={e=>setConfig({...config,routes:config.routes.map(r=>r.id===route.id?{...r,phone:e.target.value}:r)})}/></label><label>{t('keywords')}<input value={route.keywords.join(', ')} placeholder="maintenance, repair, leak" onChange={e=>setConfig({...config,routes:config.routes.map(r=>r.id===route.id?{...r,keywords:e.target.value.split(',').map(k=>k.trim()).filter(Boolean)}:r)})}/></label><button type="button" className="soft-button" aria-label={t('remove')} onClick={()=>setConfig({...config,routes:config.routes.filter(r=>r.id!==route.id)})}>×</button></div>)}
      <div className="dialog-actions"><button type="button" className="soft-button" disabled={config.routes.length>=9} onClick={()=>setConfig({...config,routes:[...config.routes,{id:crypto.randomUUID(),label:'',phone:'',keywords:[]}]})}>{t('add')}</button><button type="button" className="primary-button" onClick={()=>void save()}>{busy?t('saving'):t('save')}</button></div>
    </fieldset>}
    {webhooks.voice && <div className="communication-webhooks"><p>{t('webhooks')}</p><label>{t('voice')}<input readOnly value={webhooks.voice}/></label><label>SMS<input readOnly value={webhooks.sms ?? ''}/></label></div>}
    {loaded && deliveries.length===0 && <p>{t('noDeliveries')}</p>}
    {deliveries.length>0 && <div className="communication-history"><h3>{t('recent')}</h3>{deliveries.slice(0,10).map(d=><p key={d.id}><strong>{d.kind}</strong> · {d.status}{d.error && <span> · {d.error}</span>}</p>)}</div>}
  </details>;
}
