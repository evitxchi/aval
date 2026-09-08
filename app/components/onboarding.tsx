"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, Eye, Sparkles, Wrench, UserRound, Banknote, DoorOpen, Calculator, ChartNoAxesColumn, TrendingUp, FileCheck, Phone, Clock, Zap, Ellipsis } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { getProvider } from "@/lib/integrations/catalog";
import { ONBOARDING_OPTIONS, ONBOARDING_STEPS, parseOnboarding, togglePreference, type OnboardingState } from "@/lib/onboarding/preferences";

const PreferenceContext = createContext<{ state: OnboardingState; edit: () => void } | null>(null);
const ICONS = { all: Sparkles, maintenance: Wrench, leasing: UserRound, delinquency: Banknote, move_out: DoorOpen, accounting: Calculator, reporting: ChartNoAxesColumn, rent_increase: TrendingUp, compliance: FileCheck, yes: Phone, later: Clock, supervised: Eye, assisted: Check, autonomous: Zap, other: Ellipsis };

function TypedQuestion({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const duration = Math.min(650, text.length * 12);
    const tick = (now: number) => {
      setCount(reducedMotion ? text.length : Math.min(text.length, Math.floor((now - started) / duration * text.length)));
      if (!reducedMotion && now - started < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return <h1 ref={ref} tabIndex={-1} className="onboarding-question" ><span className="sr-only">{text}</span><span className="onboarding-question-space" aria-hidden="true">{text}</span><span className="onboarding-question-typed" aria-hidden="true">{text.slice(0, count)}<span className={count < text.length ? "typing-caret" : "typing-caret done"}/></span></h1>;
}

function OnboardingWizard({ initial, editing, onSave, onProgress, onCancel }: { initial: OnboardingState; editing: boolean; onSave: (state: OnboardingState) => void; onProgress: (state: OnboardingState) => void; onCancel: () => void }) {
  const t = useTranslations("Onboarding");
  const [state, setState] = useState(initial);
  const [step, setStep] = useState(editing ? 0 : initial.step);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const key = ONBOARDING_STEPS[step];
  const last = step === ONBOARDING_STEPS.length - 1;

  const save = async (nextStep: number, complete = false) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state, step: nextStep, completed: complete || state.completed }) });
      if (!response.ok) { setConflict(response.status === 409); setError(t(response.status === 409 ? "conflict" : "saveError")); return; }
      const saved = parseOnboarding(await response.json());
      if (!saved) throw new Error(t("saveError"));
      setState(saved);
      onProgress(saved);
      if (complete) onSave(saved);
      else { setStep(nextStep); window.scrollTo({ top: 0, behavior: "instant" }); }
    } catch { setError(t("saveError")); }
    finally { saving.current = false; setBusy(false); }
  };

  return <main className="onboarding-shell"><div className="onboarding-wrap">
    <header className="onboarding-header"><div className="onboarding-brand"><img src="/brand/aval-mark.png" alt=""/><span>Aval</span></div><span className="onboarding-progress-label">{t("step", { current: step + 1, total: ONBOARDING_STEPS.length })}</span></header>
    <div className="onboarding-progress" role="progressbar" aria-label={t("progress")} aria-valuemin={0} aria-valuemax={ONBOARDING_STEPS.length} aria-valuenow={step + 1}>{ONBOARDING_STEPS.map((id, index) => <span key={id} className={index <= step ? "active" : ""}/>)}</div>
    <section key={key} className="onboarding-step" aria-busy={busy}>
      <TypedQuestion text={t(`questions.${key}`)}/>
      <p className="onboarding-hint">{t(key === "autonomy" ? "autonomyHint" : key === "calls" ? "callsHint" : "chooseHint")}</p>
      <div className={`onboarding-choices ${key === "pms" ? "pms-grid" : key === "autonomy" ? "autonomy-grid" : "choice-flow"}`} role="group" aria-label={t(`questions.${key}`)}>
        {ONBOARDING_OPTIONS[key].map((id, index) => {
          const Icon = ICONS[id as keyof typeof ICONS];
          const selected = state.preferences[key].includes(id);
          const title = t.has(`options.${id}`) ? t(`options.${id}`) : getProvider(id)?.title ?? id;
          return <button key={id} type="button" aria-pressed={selected} disabled={busy || conflict} className={`onboarding-choice ${selected ? "selected" : ""}`} style={{ "--choice-delay": `${Math.min(index * 24, 240)}ms` } as CSSProperties} onClick={() => setState((current) => ({ ...current, preferences: togglePreference(current.preferences, key, id) }))}>
            <span className="onboarding-choice-heading">{Icon ? <Icon size={23} strokeWidth={1.8}/> : <BrandMark provider={id}/>}<span>{title}</span>{selected && <Check size={17} className="onboarding-check"/>}</span>
            {key === "autonomy" && <span className="onboarding-autonomy-copy"><strong>{t(`autonomy.${id}.visibilityTitle`)}</strong><span>{t(`autonomy.${id}.visibility`)}</span><strong>{t("control")}</strong><span>{t(`autonomy.${id}.control`)}</span></span>}
          </button>;
        })}
      </div>
      {error && <p className="onboarding-error" role="alert">{error}{conflict && <button className="soft-button" onClick={() => window.location.reload()}>{t("reload")}</button>}</p>}
      <footer className="onboarding-actions"><button className="onboarding-back" disabled={busy || conflict || (!editing && step === 0)} onClick={() => step === 0 ? onCancel() : void save(step - 1)}><ArrowLeft size={19}/>{editing && step === 0 ? t("close") : t("back")}</button><button className="primary-button" disabled={busy || conflict} onClick={() => void save(last ? step : step + 1, last)}>{busy ? t("saving") : last ? t(editing ? "save" : "finish") : state.preferences[key].length ? t("continue") : t("skip")}<ArrowRight size={18}/></button></footer>
    </section>
    <p className="onboarding-settings-note">{t("settingsHint")}</p>
  </div></main>;
}

export function OnboardingBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations("Onboarding");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/preferences", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => {
      if (!response.ok) throw new Error("Preferences unavailable");
      const loaded = parseOnboarding(await response.json());
      if (!loaded) throw new Error("Invalid preferences");
      if (!controller.signal.aborted) setState(loaded);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  if (!state) return <main className="onboarding-loading"><div className="onboarding-brand"><img src="/brand/aval-mark.png" alt=""/><span>Aval</span></div><p role="status">{t(failed ? "loadError" : "loading")}</p>{failed && <button className="primary-button" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>{t("retry")}</button>}</main>;
  return <PreferenceContext.Provider value={{ state, edit: () => setEditing(true) }}>{!state.completed || editing ? <OnboardingWizard initial={state} editing={editing} onProgress={setState} onCancel={() => setEditing(false)} onSave={(saved) => { setState(saved); setEditing(false); }}/> : children}</PreferenceContext.Provider>;
}

export function OnboardingPreferences() {
  const context = useContext(PreferenceContext);
  const t = useTranslations("Onboarding");
  if (!context) return null;
  return <section className="settings-section onboarding-preferences"><div className="settings-section-label"><h3>{t("preferencesTitle")}</h3><p>{t("preferencesDescription")}</p></div><dl>{ONBOARDING_STEPS.map((key) => <div key={key}><dt>{t(`labels.${key}`)}</dt><dd>{context.state.preferences[key].map((id) => t.has(`options.${id}`) ? t(`options.${id}`) : getProvider(id)?.title ?? id).join(", ") || t("notSelected")}</dd></div>)}</dl><button className="soft-button" onClick={context.edit}>{t("edit")}<ArrowRight size={17}/></button></section>;
}
