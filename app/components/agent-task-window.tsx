"use client";
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
export function AgentTaskWindow({title,status,sample=false,children}: {title:string;status:string;sample?:boolean;children:ReactNode}) {
  const t=useTranslations('AgentExperience');
  return <section className="agent-task-window"><header><span className="mini-window-dots" aria-hidden="true"><i/><i/><i/></span><strong><Sparkles size={15}/>{title}</strong><span className="mini-window-state">{sample?t('example'):t('live')}</span></header><div className="agent-window-body">{children}</div><footer role="status">{status}</footer></section>;
}
