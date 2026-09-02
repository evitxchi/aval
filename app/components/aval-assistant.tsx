"use client";
/* eslint-disable jsx-a11y/no-autofocus */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChatLines, CheckCircle, Database, NavArrowRight, Page, SendDiagonal, StatsUpSquare, ViewGrid, Xmark } from "iconoir-react";
import { useExperience } from "@/app/components/experience";
import type { CreateDraftInput, DraftFormat } from "@/app/components/ask-aval-tasks";
import { MarkdownPreview } from "@/app/components/markdown-preview";
import { AvalAgentAvatar, PERSONA_IDS, PERSONA_PRESETS, type PersonaId } from "@/app/components/agent-avatar";

type EvidenceRow = { label: string; value: string };
// value can be a pre-formatted string (the local sample-mode fallback
// already bakes in currency/percent formatting) or a raw number with a unit
// (what the live model returns, via its render_answer tool) — rendered
// differently below depending on which one arrives.
type Metric = { label: string; value: number | string; unit?: "currency" | "percent" | "count" | "days"; delta?: number };
type ChartPoint = { x: string; y: number };
type AnswerChart = { metric?: string; title?: string; points: ChartPoint[] };
type Answer = {
  headline: string;
  narrative: string;
  metrics: Metric[];
  evidence?: EvidenceRow[];
  evidence_ids?: string[];
  chart?: AnswerChart;
  document?: string;
  action?: string;
  actionDetail?: string;
  confidence?: "high" | "medium" | "low";
};
type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  answer?: Answer;
  // Whether this answer came from a real Claude call or the local sample-mode
  // fallback (no API key configured, or the request failed) — always shown,
  // never presented as "real analysis" when it was actually pattern-matched.
  live?: boolean;
};
function isAnswerShaped(value: unknown): value is Answer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Answer>;
  // metrics is optional in the server's render_answer schema — a real answer
  // that had no figures worth tiling is still a real answer, not a failure.
  return typeof candidate.headline === "string" && typeof candidate.narrative === "string" && (candidate.metrics === undefined || Array.isArray(candidate.metrics));
}
type SelectedModule = { label: string; snapshot: string };

function formatMetricValue(metric: Metric): string {
  if (typeof metric.value === "string") return metric.value;
  if (metric.unit === "currency") return `$${metric.value.toLocaleString()}`;
  if (metric.unit === "percent") return `${metric.value}%`;
  if (metric.unit === "days") return `${metric.value}d`;
  return metric.value.toLocaleString();
}

/** A small inline line chart for a live answer's get_metric_series result — real tool output only, never hand-drawn from prose. */
function AvalChatChart({ chart }: { chart: AnswerChart }) {
  const width = 300;
  const height = 96;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = chart.points.map((point) => point.y);
  const maxY = Math.max(...values, 1);
  const minY = Math.min(...values, 0);
  const range = maxY - minY || 1;
  const stepX = chart.points.length > 1 ? plotW / (chart.points.length - 1) : 0;
  const x = (index: number) => padding.left + index * stepX;
  const y = (value: number) => padding.top + plotH - ((value - minY) / range) * plotH;
  const linePath = chart.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.y)}`).join(" ");
  return (
    <div className="aval-chat-chart">
      {chart.title && <p>{chart.title}</p>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={chart.title ?? chart.metric ?? "Chart"}>
        <path d={linePath} className="aval-chat-chart-line" />
        {chart.points.map((point, index) => <circle key={`${point.x}-${index}`} cx={x(index)} cy={y(point.y)} r={2.5} className="aval-chat-chart-dot" />)}
      </svg>
      <div className="aval-chat-chart-labels">{chart.points.map((point, index) => <span key={`${point.x}-${index}`}>{point.x}</span>)}</div>
    </div>
  );
}

const viewNameKeys: Record<string, string> = {
  overview: "Nav.portfolioOverview",
  tasks: "Nav.avalTasks",
  inbox: "Nav.sharedInbox",
  properties: "Nav.properties",
  leasing: "Nav.leasing",
  maintenance: "Nav.maintenance",
  accounting: "Nav.accounting",
  connections: "Nav.connections",
  documents: "Nav.documents",
  settings: "Nav.settings",
};

const suggestionKeys = ["AvalAssistant.suggestion1", "AvalAssistant.suggestion2", "AvalAssistant.suggestion3"];
const focusedSuggestionKeys = ["AvalAssistant.focusedSuggestion1", "AvalAssistant.focusedSuggestion2", "AvalAssistant.focusedSuggestion3"];

const moduleSelector = [
  "[data-ai-module]",
  ".metric-card",
  ".panel",
  ".task-column",
  ".task-card",
  ".conversation-row",
  ".message-thread",
  ".contact-panel",
  ".required-source",
  ".connection-card",
  ".locked-panel",
  ".settings-card",
].join(",");

function describeModule(element: HTMLElement): SelectedModule {
  const labelNode = element.querySelector<HTMLElement>(
    ".metric-top span, .panel-heading h2, .column-heading h2, .task-card-top strong, .conversation-row strong, h2, h3, strong",
  );
  const label = element.dataset.aiLabel ?? labelNode?.innerText.trim() ?? "Dashboard module";
  const snapshot = element.innerText.replace(/\s+/g, " ").trim().slice(0, 260);
  return { label, snapshot };
}

function analyzeQuestion(t: ReturnType<typeof useTranslations>, question: string, view: string, selectedModule: SelectedModule | null): Answer {
  const normalized = `${selectedModule?.label ?? ""} ${selectedModule?.snapshot ?? ""} ${question}`.toLocaleLowerCase();

  if (/net operating income|ingreso operativo neto|\bnoi\b/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerNoiHeadline"),
      narrative: t("AvalAssistant.answerNoiSummary"),
      metrics: [{ label: t("AvalAssistant.answerNoiStat1"), value: "MX$286,410" }, { label: t("AvalAssistant.answerNoiStat2"), value: "+4.8%" }, { label: t("AvalAssistant.answerNoiStat3"), value: "MX$438,900" }],
      evidence: [{ label: t("AvalAssistant.answerNoiEvidence1"), value: "+MX$18,600" }, { label: t("AvalAssistant.answerNoiEvidence2"), value: "−MX$7,200" }, { label: t("AvalAssistant.answerNoiEvidence3"), value: "+MX$4,100" }],
      action: t("AvalAssistant.answerNoiAction"),
      actionDetail: t("AvalAssistant.answerNoiActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/data coverage|cobertura de datos|source|fuente/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerCoverageHeadline"),
      narrative: t("AvalAssistant.answerCoverageSummary"),
      metrics: [{ label: t("AvalAssistant.answerCoverageStat1"), value: "2" }, { label: t("AvalAssistant.answerCoverageStat2"), value: "0" }, { label: t("AvalAssistant.answerCoverageStat3"), value: "1" }],
      evidence: [{ label: t("AvalAssistant.answerCoverageEvidence1"), value: "QuickBooks or Xero" }, { label: t("AvalAssistant.answerCoverageEvidence2"), value: "AppFolio, Buildium, or PMS" }, { label: t("AvalAssistant.answerCoverageEvidence3"), value: "Optional" }],
      action: t("AvalAssistant.answerCoverageAction"),
      actionDetail: t("AvalAssistant.answerCoverageActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/lead-to-lease|funnel|embudo|prospecto|contacted|contactados/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerFunnelHeadline"),
      narrative: t("AvalAssistant.answerFunnelSummary"),
      metrics: [{ label: t("AvalAssistant.answerFunnelStat1"), value: "148" }, { label: t("AvalAssistant.answerFunnelStat2"), value: "82" }, { label: t("AvalAssistant.answerFunnelStat3"), value: "21" }],
      evidence: [{ label: t("AvalAssistant.answerFunnelEvidence1"), value: "55.4%" }, { label: t("AvalAssistant.answerFunnelEvidence2"), value: "45.1%" }, { label: t("AvalAssistant.answerFunnelEvidence3"), value: "56.8%" }],
      action: t("AvalAssistant.answerFunnelAction"),
      actionDetail: t("AvalAssistant.answerFunnelActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/collect|rent|delinquen|payment|cobran|renta|pago|moros/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerCollectionsHeadline"),
      narrative: t("AvalAssistant.answerCollectionsSummary"),
      metrics: [{ label: t("AvalAssistant.answerCollectionsStat1"), value: "92.6%" }, { label: t("AvalAssistant.answerCollectionsStat2"), value: "MX$28,500" }, { label: t("AvalAssistant.answerCollectionsStat3"), value: "3 of 84" }],
      evidence: [{ label: t("AvalAssistant.answerCollectionsEvidence1"), value: "38 days · MX$12,000" }, { label: t("AvalAssistant.answerCollectionsEvidence2"), value: "Promise broken · MX$9,500" }, { label: t("AvalAssistant.answerCollectionsEvidence3"), value: "32 days · MX$7,000" }],
      action: t("AvalAssistant.answerCollectionsAction"),
      actionDetail: t("AvalAssistant.answerCollectionsActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/maintenance|work order|repair|ticket|mantenimiento|reparaci|orden/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerMaintenanceHeadline"),
      narrative: t("AvalAssistant.answerMaintenanceSummary"),
      metrics: [{ label: t("AvalAssistant.answerMaintenanceStat1"), value: "18" }, { label: t("AvalAssistant.answerMaintenanceStat2"), value: "4" }, { label: t("AvalAssistant.answerMaintenanceStat3"), value: "3h" }],
      evidence: [{ label: t("AvalAssistant.answerMaintenanceEvidence1"), value: "Active leak · 3h" }, { label: t("AvalAssistant.answerMaintenanceEvidence2"), value: "No hot water · 7h" }, { label: t("AvalAssistant.answerMaintenanceEvidence3"), value: "Lighting · 11h" }],
      action: t("AvalAssistant.answerMaintenanceAction"),
      actionDetail: t("AvalAssistant.answerMaintenanceActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/vacan|leasing|lease|occup|unit|arrend|ocup|unidad/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerVacancyHeadline"),
      narrative: t("AvalAssistant.answerVacancySummary"),
      metrics: [{ label: t("AvalAssistant.answerVacancyStat1"), value: "94.2%" }, { label: t("AvalAssistant.answerVacancyStat2"), value: "5" }, { label: t("AvalAssistant.answerVacancyStat3"), value: "MX$41,200" }],
      evidence: [{ label: t("AvalAssistant.answerVacancyEvidence1"), value: "31 days · +9.1% vs comps" }, { label: t("AvalAssistant.answerVacancyEvidence2"), value: "27 days · +7.3% vs comps" }],
      action: t("AvalAssistant.answerVacancyAction"),
      actionDetail: t("AvalAssistant.answerVacancyActionDetail"),
      confidence: "medium" as const,
    };
  }
  if (/today|attention|priority|risk|hoy|atenci|prioridad|riesgo/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerTodayHeadline"),
      narrative: t("AvalAssistant.answerTodaySummary"),
      metrics: [{ label: t("AvalAssistant.answerTodayStat1"), value: "MX$28,500" }, { label: t("AvalAssistant.answerTodayStat2"), value: "4" }, { label: t("AvalAssistant.answerTodayStat3"), value: "MX$41,200" }],
      evidence: [{ label: t("AvalAssistant.answerTodayEvidence1"), value: "3 reachable accounts" }, { label: t("AvalAssistant.answerTodayEvidence2"), value: "SLA breach in 3h" }, { label: t("AvalAssistant.answerTodayEvidence3"), value: "27–31 days" }],
      action: t("AvalAssistant.answerTodayAction"),
      actionDetail: t("AvalAssistant.answerTodayActionDetail"),
      confidence: "medium" as const,
    };
  }

  const currentViewKey = viewNameKeys[view] ?? viewNameKeys.overview;
  const subject = selectedModule ? t("AvalAssistant.generalSubjectModule", { label: selectedModule.label }) : t(currentViewKey);
  return {
    headline: t("AvalAssistant.answerGeneralHeadlineModule", { subject }),
    narrative: t("AvalAssistant.answerGeneralSummary"),
    metrics: [
      { label: t("AvalAssistant.answerGeneralStat1"), value: "142" },
      { label: t("AvalAssistant.answerGeneralStat2"), value: "6" },
      { label: t("AvalAssistant.answerGeneralStat3"), value: "3" },
    ],
    evidence: [
      { label: t("AvalAssistant.answerGeneralEvidence1"), value: t("AvalAssistant.dataFreshness4MinAgo") },
      { label: t("AvalAssistant.answerGeneralEvidence2"), value: "Acme Residential" },
    ],
    confidence: "medium" as const,
  };
}

export function AvalAssistant({ view, onCreateDraft }: { view: string; onCreateDraft: (input: CreateDraftInput) => void }) {
  const { notify } = useExperience();
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pickingModule, setPickingModule] = useState(false);
  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);
  const [pickingPersona, setPickingPersona] = useState(false);
  const [personaId, setPersonaId] = useState<PersonaId>("general");
  const activePersona = PERSONA_PRESETS[personaId];
  const [prepared, setPrepared] = useState<Record<number, boolean>>({});
  const [draftPanelOpen, setDraftPanelOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftInstructions, setDraftInstructions] = useState("");
  const [draftFormat, setDraftFormat] = useState<DraftFormat>("docx");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: t("AvalAssistant.welcomeMessage"),
    },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const nextId = useRef(2);
  const currentContext = useMemo(() => t(viewNameKeys[view] ?? viewNameKeys.overview), [t, view]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, open]);

  useEffect(() => {
    selectedElementRef.current?.classList.remove("aval-ai-module-selected");
    selectedElementRef.current = null;
    queueMicrotask(() => {
      setSelectedModule(null);
      setPickingModule(false);
    });
  }, [view]);

  useEffect(() => {
    if (!open || !pickingModule) return;
    document.documentElement.classList.add("aval-module-picking");
    let hovered: HTMLElement | null = null;

    const findModule = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || target.closest(".aval-assistant")) return null;
      return target.closest<HTMLElement>(moduleSelector);
    };
    const hoverModule = (event: PointerEvent) => {
      const next = findModule(event.target);
      if (next === hovered) return;
      hovered?.classList.remove("aval-ai-module-hover");
      hovered = next;
      hovered?.classList.add("aval-ai-module-hover");
    };
    const selectModule = (event: MouseEvent) => {
      const target = findModule(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const moduleContext = describeModule(target);
      hovered?.classList.remove("aval-ai-module-hover");
      selectedElementRef.current?.classList.remove("aval-ai-module-selected");
      target.classList.add("aval-ai-module-selected");
      selectedElementRef.current = target;
      setSelectedModule(moduleContext);
      setPickingModule(false);
      setMessages((current) => [...current, {
        id: nextId.current++,
        role: "assistant",
        text: t("AvalAssistant.moduleSelectedMessage", { module: moduleContext.label }),
      }]);
    };

    document.addEventListener("pointerover", hoverModule, true);
    document.addEventListener("click", selectModule, true);
    return () => {
      document.documentElement.classList.remove("aval-module-picking");
      hovered?.classList.remove("aval-ai-module-hover");
      document.removeEventListener("pointerover", hoverModule, true);
      document.removeEventListener("click", selectModule, true);
    };
  }, [open, pickingModule, t]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickingModule) {
        setPickingModule(false);
        return;
      }
      setOpen(false);
      selectedElementRef.current?.classList.remove("aval-ai-module-selected");
      selectedElementRef.current = null;
      setSelectedModule(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pickingModule]);

  // Tries the real Claude API first, grounded in the same dashboard data the
  // page shows. Falls back to the local sample-mode analyzer — and says so —
  // if no key is configured yet or the request fails, so the assistant
  // never silently claims a canned pattern-match was live analysis.
  const submitQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || thinking) return;
    const focusedModule = selectedModule;
    const userMessage: ChatMessage = { id: nextId.current++, role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setThinking(true);
    try {
      const response = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, view, moduleLabel: focusedModule?.label, moduleSnapshot: focusedModule?.snapshot, locale, personaId }),
      });
      // The endpoint returns the render_answer payload flattened at the top
      // level (plus tools_used), not wrapped in an { answer: ... } envelope.
      const data = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok || !isAnswerShaped(data)) throw new Error(typeof data.error === "string" ? data.error : "The assistant is unavailable right now.");
      const answer = { ...data, metrics: Array.isArray(data.metrics) ? data.metrics : [] } as Answer;
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", answer, live: true }]);
    } catch {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", answer: analyzeQuestion(t, trimmed, view, focusedModule), live: false }]);
    } finally {
      setThinking(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitQuestion(input);
  };

  const prepareAction = (message: ChatMessage) => {
    if (!message.answer?.action) return;
    setPrepared((current) => ({ ...current, [message.id]: true }));
    onCreateDraft({
      title: message.answer.action,
      instructions: `Draft the full write-up for this approved action so it is ready to send: "${message.answer.action}". ${message.answer.actionDetail ?? ""} It follows from this finding: ${message.answer.headline}`,
      format: "docx",
      personaId,
    });
    notify(t("AvalAssistant.actionPreparedForReview"), t("AvalAssistant.draftStartedInTasks"));
  };

  const startDraft = (event: FormEvent) => {
    event.preventDefault();
    if (!draftTitle.trim() || !draftInstructions.trim()) return;
    onCreateDraft({
      title: draftTitle.trim(),
      instructions: draftInstructions.trim(),
      format: draftFormat,
      moduleLabel: selectedModule?.label,
      moduleSnapshot: selectedModule?.snapshot,
      personaId,
    });
    setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: t("AvalAssistant.draftStartedMessage", { title: draftTitle.trim() }) }]);
    setDraftTitle(""); setDraftInstructions(""); setDraftFormat("docx"); setDraftPanelOpen(false);
  };

  const clearSelectedModule = () => {
    selectedElementRef.current?.classList.remove("aval-ai-module-selected");
    selectedElementRef.current = null;
    setSelectedModule(null);
    setPickingModule(false);
  };

  const closeAssistant = () => {
    clearSelectedModule();
    setOpen(false);
  };

  const toggleAssistant = () => {
    if (open) closeAssistant();
    else setOpen(true);
  };

  const promptSuggestions = selectedModule ? focusedSuggestionKeys : messages.length === 1 ? suggestionKeys : [];

  return (
    <div className={`aval-assistant ${open ? "is-open" : ""}`}>
      {open && (
        <section className="aval-assistant-panel" role="dialog" aria-label={t("AvalAssistant.avalAssistant")}>
          <header className="aval-assistant-header">
            <div className="aval-assistant-identity">
              {personaId === "general" ? (
                <span className="aval-assistant-mark" aria-hidden="true" />
              ) : (
                <AvalAgentAvatar shape={activePersona.shape} theme={activePersona.theme} size={38} label={t(activePersona.labelKey)} />
              )}
              <span><strong>{t(activePersona.labelKey)}</strong><small><i />{t("AvalAssistant.liveDashboardContext")}</small></span>
            </div>
            <button className="aval-assistant-close" type="button" onClick={closeAssistant} aria-label={t("AvalAssistant.closeAssistant")}><Xmark width={19} height={19} /></button>
          </header>

          <div className="aval-assistant-context">
            <div className="aval-chat-context-row">
              <span className="aval-chat-scope"><Database width={15} height={15} /><span>{currentContext}</span><span>·</span><span>Acme Residential</span></span>
              <button className={`aval-module-picker ${pickingModule ? "active" : ""}`} type="button" onClick={() => setPickingModule((current) => !current)} aria-pressed={pickingModule}>
                <ViewGrid width={15} height={15} />{selectedModule ? t("AvalAssistant.changeModule") : t("AvalAssistant.selectModule")}
              </button>
              <button className={`aval-module-picker ${draftPanelOpen ? "active" : ""}`} type="button" onClick={() => setDraftPanelOpen((current) => !current)} aria-pressed={draftPanelOpen}>
                <Page width={15} height={15} />{t("AvalAssistant.draftDocument")}
              </button>
              <button className={`aval-module-picker ${pickingPersona ? "active" : ""}`} type="button" onClick={() => setPickingPersona((current) => !current)} aria-pressed={pickingPersona}>
                <AvalAgentAvatar shape={activePersona.shape} theme={activePersona.theme} size={17} />
                {personaId === "general" ? t("AvalAssistant.selectAgent") : t(activePersona.labelKey)}
              </button>
            </div>
            {pickingModule && <p className="aval-module-picker-instruction"><span />{t("AvalAssistant.hoverOverADashboardModuleThen")}</p>}
            {pickingPersona && (
              <div className="aval-agent-picker">
                {PERSONA_IDS.map((id) => {
                  const preset = PERSONA_PRESETS[id];
                  return (
                    <button key={id} type="button" className="aval-agent-picker-item" aria-pressed={personaId === id} onClick={() => { setPersonaId(id); setPickingPersona(false); }}>
                      <AvalAgentAvatar shape={preset.shape} theme={preset.theme} size={40} selected={personaId === id} interactive />
                      <span>{t(preset.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedModule && (
              <div className="aval-selected-module-context">
                <ViewGrid width={16} height={16} />
                <span><small>{t("AvalAssistant.focusedModule")}</small><strong>{selectedModule.label}</strong></span>
                <button type="button" onClick={clearSelectedModule} aria-label={t("AvalAssistant.clearSelectedModule")}><Xmark width={15} height={15} /></button>
              </div>
            )}
            {draftPanelOpen && (
              <form className="aval-draft-panel" onSubmit={startDraft}>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder={t("AvalAssistant.draftTitlePlaceholder")} autoFocus />
                <textarea value={draftInstructions} onChange={(event) => setDraftInstructions(event.target.value)} placeholder={t("AvalAssistant.draftInstructionsPlaceholder")} />
                <div className="aval-draft-panel-row">
                  <select value={draftFormat} onChange={(event) => setDraftFormat(event.target.value as DraftFormat)}>
                    <option value="docx">{t("AvalAssistant.formatDocx")}</option>
                    <option value="xlsx">{t("AvalAssistant.formatXlsx")}</option>
                    <option value="pptx">{t("AvalAssistant.formatPptx")}</option>
                  </select>
                  <button type="submit" className="primary-button" disabled={!draftTitle.trim() || !draftInstructions.trim()}>
                    <NavArrowRight width={16} height={16} />{t("AvalAssistant.startDrafting")}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="aval-assistant-stream" ref={streamRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`aval-chat-message ${message.role}`} key={message.id}>
                {message.text && <p>{message.text}</p>}
                {message.answer && (
                  <div className="aval-chat-answer">
                    <div className="aval-chat-answer-heading">
                      <StatsUpSquare width={18} height={18} />
                      <strong>{message.answer.headline}</strong>
                      {message.answer.confidence && <span className={`aval-chat-confidence ${message.answer.confidence}`}>{t(`AvalAssistant.confidence${message.answer.confidence[0].toUpperCase()}${message.answer.confidence.slice(1)}`)}</span>}
                    </div>
                    <p>{message.answer.narrative}</p>
                    {message.answer.metrics.length > 0 && (
                      <div className="aval-chat-stats">
                        {message.answer.metrics.map((metric) => <span key={metric.label}><small>{metric.label}</small><strong>{formatMetricValue(metric)}</strong></span>)}
                      </div>
                    )}
                    {message.answer.chart && message.answer.chart.points.length > 0 && <AvalChatChart chart={message.answer.chart} />}
                    {message.answer.document && <div className="aval-chat-document"><MarkdownPreview text={message.answer.document} /></div>}
                    {(message.answer.evidence?.length || message.answer.evidence_ids?.length) ? (
                      <details className="aval-chat-evidence">
                        <summary>{t("AvalAssistant.viewEvidence")}<NavArrowRight width={15} height={15} /></summary>
                        <div>
                          {message.answer.evidence?.map((row) => <span key={row.label}><small>{row.label}</small><strong>{row.value}</strong></span>)}
                          {!message.answer.evidence && message.answer.evidence_ids?.map((id) => <span key={id}><small>{id}</small></span>)}
                        </div>
                        <p><CheckCircle width={14} height={14} />{t("AvalAssistant.calculatedFromTheDashboardSnapshotUpdated")}</p>
                      </details>
                    ) : null}
                    {message.answer.action && (
                      <button className="aval-chat-action" type="button" disabled={prepared[message.id]} onClick={() => prepareAction(message)}>
                        {prepared[message.id] ? <CheckCircle width={17} height={17} /> : <SendDiagonal width={17} height={17} />}
                        <span><strong>{prepared[message.id] ? t("AvalAssistant.preparedForReview") : message.answer.action}</strong><small>{message.answer.actionDetail ?? message.answer.action}</small></span>
                        {!prepared[message.id] && <NavArrowRight width={17} height={17} />}
                      </button>
                    )}
                    {message.live === false && <p className="aval-chat-sample-note">{t("AvalAssistant.sampleModeAnswer")}</p>}
                  </div>
                )}
              </div>
            ))}
            {thinking && <div className="aval-chat-thinking" aria-label={t("AvalAssistant.analyzingDashboardData")}><i /><i /><i /><span>{t("AvalAssistant.analyzingDashboardData")}</span></div>}
          </div>

          {promptSuggestions.length > 0 && (
            <div className="aval-chat-suggestions">
              {promptSuggestions.map((key) => <button type="button" key={key} onClick={() => submitQuestion(t(key))}>{t(key)}<NavArrowRight width={15} height={15} /></button>)}
            </div>
          )}

          <form className="aval-chat-composer" onSubmit={onSubmit}>
            <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={selectedModule ? t("AvalAssistant.askAboutModulePlaceholder", { module: selectedModule.label }) : t("AvalAssistant.askAboutYourPortfolio")} aria-label={t("AvalAssistant.askAval")} />
            <button type="submit" disabled={!input.trim() || thinking} aria-label={t("AvalAssistant.sendMessage")}><SendDiagonal width={18} height={18} /></button>
          </form>
          <p className="aval-chat-disclaimer">{t("AvalAssistant.avalShowsItsEvidenceAndAsks")}</p>
        </section>
      )}

      <button className="aval-assistant-launcher" type="button" onClick={toggleAssistant} aria-expanded={open} aria-label={open ? t("AvalAssistant.closeAvalAssistant") : t("AvalAssistant.askAval")}>
        {open ? <Xmark width={22} height={22} /> : <ChatLines width={23} height={23} />}
        {!open && <span aria-hidden="true" />}
      </button>
    </div>
  );
}
