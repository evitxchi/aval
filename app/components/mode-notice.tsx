"use client";
import { useEffect, useState, type ReactNode } from 'react';
import type { AutonomyMode } from '@/lib/agents/autonomy';
export function ModeNotice({ mode, paused, children }: {mode: AutonomyMode; paused: boolean; children: ReactNode}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [paused]);
  return <div className={`mode-notice ${visible ? 'is-visible' : ''}`} aria-hidden={!visible} inert={!visible}>
    <div><div className="independence-session-bar" data-mode={mode}>{children}</div></div>
  </div>;
}
