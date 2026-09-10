"use client";
import { useTranslations } from "next-intl";
import { Check, Eye, Zap, CircleHelp, Handshake } from "lucide-react";
import { autonomyMode, type AutonomyMode } from "@/lib/agents/autonomy";
import { useOnboarding } from "./preference-context";
const MODES = ["supervised", "assisted", "autonomous"] as const;
const ICONS = { supervised: Eye, assisted: Handshake, autonomous: Zap };

export function ModeChoices({ mode, onChange, disabled, compact = false }: {
  mode: AutonomyMode; onChange: (mode: AutonomyMode) => void; disabled?: boolean; compact?: boolean;
}) {
  const t = useTranslations("Independence");
  const o = useTranslations("Onboarding");
  return <div className={`independence-options ${compact ? "compact" : ""}`} role="group" aria-label={t("title")}>
    {MODES.map(id => { const Icon = ICONS[id]; return <button key={id} type="button" aria-pressed={mode === id} disabled={disabled}
      className={`independence-option ${mode === id ? "selected" : ""}`} data-mode={id} onClick={() => onChange(id)}>
      <span><Icon size={17}/><strong>{o(`options.${id}`)}</strong>{mode === id && <Check size={15}/>}</span>
      {!compact && <small>{t(`modes.${id}`)}</small>}
    </button>; })}
  </div>;
}

export function AvalGuide() {
  const t = useTranslations("Independence");
  return <div className="aval-guide"><h3>{t("howTitle")}</h3><ol><li>{t("howConnect")}</li><li>{t("howAsk")}</li><li>{t("howReview")}</li></ol><p>{t("limits")}</p></div>;
}

export function IndependenceControls({ compact = false }: { compact?: boolean }) {
  const context = useOnboarding();
  const t = useTranslations("Independence");
  const o = useTranslations("Onboarding");
  if (!context) return null;
  const mode = autonomyMode(context.state.preferences.autonomy[0]);
  return <section className={`independence-controls ${compact ? "compact" : "panel setup-panel"}`} aria-label={t("title")}>
    <div className="independence-heading"><h3>{t("title")}</h3><button type="button" className="text-button" onClick={context.help}><CircleHelp size={16}/>{t("guide")}</button></div>
    <ModeChoices mode={mode} onChange={next => void context.setMode(next)} disabled={context.busy} compact={compact}/>
    <p className="independence-current" role="status">{context.busy ? t("switching") : t("active", { mode: o(`options.${mode}`) })} · {t(`modes.${mode}`)}</p>
    {context.error && <p role="alert" className="onboarding-error">{context.error}</p>}
  </section>;
}
