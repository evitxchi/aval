"use client";
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, X, Compass } from 'lucide-react';
import { TOUR_MODULES, type TourModule } from '@/lib/tutorial/modules';
import { AnimatedCopy } from './animated-copy';
import { tourPlacement } from '@/lib/tutorial/placement';

export function TourButton() {
  const t = useTranslations('Tour');
  return <button type="button" className="tour-start soft-button" onClick={() => window.dispatchEvent(new Event('aval:tour:start'))}><Compass size={17}/>{t('start')}</button>;
}
export function ModuleTour({onNavigate, currentView}: {onNavigate: (view: Exclude<TourModule,'chat'>) => void; currentView: string}) {
  const t = useTranslations('Tour');
  const [index, setIndex] = useState(-1);
  const [anchor, setAnchor] = useState({left:16, top:120, width:190, height:40});
  const [viewport, setViewport] = useState({width:1024,height:768});
  const [cardHeight, setCardHeight] = useState(300);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(currentView);
  const navigate = useRef(onNavigate);
  useEffect(() => { navigate.current = onNavigate; }, [onNavigate]);
  useEffect(() => {
    const start = () => { previousView.current = currentView; setIndex(0); };
    window.addEventListener('aval:tour:start',start);
    return () => window.removeEventListener('aval:tour:start',start);
  },[currentView]);
  const tourModule = TOUR_MODULES[Math.max(0,index)];
  useEffect(() => {
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      if (cardRef.current) observer.observe(cardRef.current);
    });
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.target.getBoundingClientRect().height;
      if (height) setCardHeight(height);
    });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [index]);
  useEffect(() => {
    if (index < 0) return;
    if (tourModule !== 'chat') navigate.current(tourModule);
    window.dispatchEvent(new CustomEvent('aval:tour:chat',{detail:tourModule === 'chat'}));
    const selector = `[data-tour-target="${tourModule}"]`;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(selector);
        const rect = target?.getBoundingClientRect();
        const usable = rect && rect.width > 0 && rect.height > 0;
        setAnchor(usable ? {left:rect.left,top:rect.top,width:rect.width,height:rect.height} : {left:16,top:70,width:Math.min(200,innerWidth-32),height:40});
        setViewport({width:innerWidth,height:innerHeight});
      });
    };
    document.querySelector(selector)?.scrollIntoView({block:'nearest',behavior:'instant'});
    measure();
    window.addEventListener('resize',measure);
    window.addEventListener('scroll',measure,true);
    const observer = new ResizeObserver(measure); observer.observe(document.body);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize',measure); window.removeEventListener('scroll',measure,true); };
  },[index,tourModule]);
  const close = () => { setIndex(-1); if (TOUR_MODULES.includes(previousView.current as TourModule) && previousView.current !== 'chat') navigate.current(previousView.current as Exclude<TourModule,'chat'>); };
  const placement = tourPlacement(anchor, viewport, cardHeight);
  return <Dialog.Root open={index>=0} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="tour-overlay"/>
    <div aria-hidden="true" className="tour-spotlight" style={{left:anchor.left-4,top:anchor.top-4,width:anchor.width+8,height:anchor.height+8}}/>
    <span className={`tour-pointer points-${placement.pointer.direction}`} style={{left:placement.pointer.left,top:placement.pointer.top}} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M0 14H26M17 5L26 14L17 23" stroke="currentColor" strokeWidth="2"/></svg></span>
    <Dialog.Content ref={cardRef} className="tour-card" style={placement.card} onInteractOutside={e=>e.preventDefault()}>
      <div className="tour-card-top"><span>{t('step',{current:index+1,total:TOUR_MODULES.length})}</span><Dialog.Close className="icon-button" aria-label={t('close')}><X size={18}/></Dialog.Close></div>
      <Dialog.Title><AnimatedCopy key={tourModule+'title'} text={t(`modules.${tourModule}.title`)}/></Dialog.Title>
      <Dialog.Description asChild><p><AnimatedCopy key={tourModule+'body'} text={t(`modules.${tourModule}.body`)}/></p></Dialog.Description>
      <div className="tour-progress" aria-hidden="true">{TOUR_MODULES.map((id,i)=><i key={id} className={i<=index?'active':''}/>)}</div>
      <footer><button type="button" className="soft-button" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ArrowLeft size={16}/>{t('back')}</button><button type="button" className="primary-button" onClick={()=>index===TOUR_MODULES.length-1?close():setIndex(i=>i+1)}>{t(index===TOUR_MODULES.length-1?'finish':'next')}<ArrowRight size={16}/></button></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
