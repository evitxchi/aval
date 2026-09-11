"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dockPanel, dragDestination, fitPanel, resizePanel, type PanelRect, type ResizeEdge } from '@/lib/ask-aval/panel-geometry';

import { DEFAULT_CHAT_TRANSPARENCY } from '@/lib/appearance';

const STORAGE_KEY = 'aval.chat.placement.v1';
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
export function useChatPanel(onPopupBlocked: () => void, background: "white" | "glass" = "white", theme: "light" | "dark" = "light", transparency = DEFAULT_CHAT_TRANSPARENCY) {
  const panelRef = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<PanelRect | null>(null);
  const [docked, setDocked] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<'window' | 'dock' | 'float'>('float');
  const [popupRoot, setPopupRoot] = useState<HTMLElement | null>(null);
  const popup = useRef<Window | null>(null);
  useEffect(() => {
    popupRoot?.style.setProperty('--aval-glass-opacity', String(1 - transparency / 100));
  }, [popupRoot, transparency]);
  useEffect(() => {
    let live = true;
    const doc = popupRoot?.ownerDocument;
    if (doc) {
      doc.documentElement.setAttribute("data-chat-background", background);
      doc.documentElement.setAttribute('data-theme', background === 'white' ? 'light' : theme);
    }
    const bridge = window.avalDesktop;
    if (bridge?.setChatBackground) {
      void bridge.setChatBackground(background, theme).then(result => {
        if (live && doc) {
          doc.documentElement.setAttribute('data-native-glass', String(result.nativeGlass));
          doc.documentElement.setAttribute('data-native-titlebar', String(result.nativeTitlebar === true));
          doc.documentElement.setAttribute('data-native-window', 'true');
        }
      }).catch(() => { if (live && doc) doc.documentElement.setAttribute('data-native-glass', 'false'); });
    }
    return () => { live = false; };
  }, [background, popupRoot, theme]);
  const popupCleanup = useRef<() => void>(() => {});
  const previousRect = useRef<PanelRect | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; rect: PanelRect; edge?: ResizeEdge; moved: boolean } | null>(null);
  const remember = (next: PanelRect, dock: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rect: next, docked: dock })); } catch { /* geometry remains usable without storage */ }
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (saved?.rect && ['x', 'y', 'width', 'height'].every(key => typeof saved.rect[key] === 'number' && Number.isFinite(saved.rect[key]))) {
          setRect(saved.docked ? dockPanel(saved.rect, viewport()) : fitPanel(saved.rect, viewport())); setDocked(saved.docked === true);
        }
      } catch { /* use default panel */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const resize = () => setRect(current => current ? (docked && !minimized ? dockPanel(current, viewport()) : fitPanel(current, viewport(), minimized)) : null);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [docked, minimized]);
  useEffect(() => () => { popupCleanup.current(); popup.current?.close(); }, []);
  const currentRect = (): PanelRect => {
    const bounds = panelRef.current?.getBoundingClientRect();
    return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : fitPanel({ x: window.innerWidth - 496, y: 16, width: 480, height: 680 }, viewport());
  };
  const reattach = () => {
    popupCleanup.current(); popup.current?.close(); popup.current = null; setPopupRoot(null);
  };
  const detach = (screenX?: number, screenY?: number) => {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const child = window.open('about:blank', 'aval-chat', `popup=yes,width=500,height=720${screenX !== undefined ? `,left=${Math.round(screenX - 220)},top=${Math.round((screenY ?? 0) - 30)}` : ''}`);
    if (!child) { onPopupBlocked(); return; }
    try {
      child.document.title = 'Ask Aval';
      const base = child.document.createElement('base'); base.href = window.location.href; child.document.head.appendChild(base);
      const styles = child.document.createElement('div'); child.document.head.appendChild(styles);
      const syncStyles = () => {
        styles.replaceChildren(...Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.cloneNode(true)));
        for (const attr of Array.from(document.documentElement.attributes)) child.document.documentElement.setAttribute(attr.name, attr.value);
        if (child.document.documentElement.dataset.chatBackground === 'white') child.document.documentElement.dataset.theme = 'light';
        child.document.body.className = document.body.className;
        child.document.body.classList.add('aval-chat-popout');
      };
      syncStyles();
      const observer = new MutationObserver(syncStyles);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      const root = child.document.createElement('div'); root.id = 'aval-chat-window'; child.document.body.replaceChildren(root);
      const returned = () => { observer.disconnect(); popup.current = null; setPopupRoot(null); };
      const parentClosing = () => child.close();
      child.addEventListener('beforeunload', returned);
      window.addEventListener('beforeunload', parentClosing);
      const timer = window.setInterval(() => { if (child.closed) { returned(); cleanup(); } }, 500);
      const cleanup = () => { observer.disconnect(); clearInterval(timer); child.removeEventListener('beforeunload', returned); window.removeEventListener('beforeunload', parentClosing); };
      popupCleanup.current = cleanup; popup.current = child;
      if (minimized) setRect(fitPanel(previousRect.current ?? { ...currentRect(), height: 680 }, viewport()));
      setMinimized(false); setPopupRoot(root); child.focus();
    } catch { child.close(); onPopupBlocked(); }
  };
  const begin = (event: ReactPointerEvent<HTMLElement>, edge?: ResizeEdge) => {
    if (popupRoot || event.button !== 0 || (!edge && (event.target as Element).closest('button, a, input, select'))) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: currentRect(), edge, moved: false };
    setDragging(true);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) < 4 && !active.moved) return;
    active.moved = true;
    setExpanded(false);
    if (active.edge) {
      setRect(resizePanel(active.rect, active.edge, dx, dy, viewport()));
      // Resizing a docked rail's left edge preserves the dock; other edges float it.
      if (active.edge !== 'w') setDocked(false);
    } else {
      setDocked(false); setRect(fitPanel({ ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }, viewport(), minimized));
      setDropTarget(dragDestination(event.clientX, event.clientY, viewport()));
    }
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false); setDropTarget('float');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel' || !active.moved) return;
    const resizedHeight = active.rect.height + (active.edge?.includes('n') ? active.y - event.clientY : event.clientY - active.y);
    if (active.edge && /[ns]/.test(active.edge) && resizedHeight < 180) {
      previousRect.current = active.rect;
      setDocked(false); setMinimized(true); setRect(fitPanel(currentRect(), viewport(), true));
      return;
    }
    const target = active.edge ? 'float' : dragDestination(event.clientX, event.clientY, viewport());
    if (target === 'window') { detach(event.screenX, event.screenY); return; }
    const next = target === 'dock' ? dockPanel(currentRect(), viewport()) : currentRect();
    if (target === 'dock') { setDocked(true); setMinimized(false); setRect(next); }
    remember(next, target === 'dock' || (docked && active.edge === 'w'));
  };
  const toggleDock = () => {
    setMinimized(false); setExpanded(false);
    const next = docked ? fitPanel({ ...currentRect(), x: window.innerWidth - 520, y: 24, height: 680 }, viewport()) : dockPanel(currentRect(), viewport());
    setDocked(!docked); setRect(next); remember(next, !docked);
  };
  const toggleMinimized = () => {
    if (!minimized) { previousRect.current = currentRect(); setRect(fitPanel(currentRect(), viewport(), true)); }
    else setRect(docked ? dockPanel(previousRect.current ?? currentRect(), viewport()) : fitPanel(previousRect.current ?? { ...currentRect(), height: 680 }, viewport()));
    setMinimized(!minimized);
  };
  const toggleExpanded = () => {
    const next = expanded ? previousRect.current ?? currentRect() : fitPanel({ ...currentRect(), x: window.innerWidth - 824, y: 16, width: 800, height: window.innerHeight - 32 }, viewport());
    if (!expanded) previousRect.current = currentRect();
    setRect(fitPanel(next, viewport())); setExpanded(!expanded); setMinimized(false); setDocked(false);
  };
  return { panelRef, rect, docked, minimized, expanded, dragging, dropTarget, popupRoot, detach, reattach, toggleDock, toggleMinimized, toggleExpanded,
    restore: () => { if (minimized) toggleMinimized(); popup.current?.focus(); }, begin,
    pointerHandlers: { onPointerMove: move, onPointerUp: end, onPointerCancel: end } };
}
