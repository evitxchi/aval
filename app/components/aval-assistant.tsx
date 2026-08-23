"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ChatLines, CheckCircle, Database, NavArrowRight, SendDiagonal, StatsUpSquare, ViewGrid, Xmark } from "iconoir-react";
import { useExperience } from "@/app/components/experience";

type EvidenceRow = { label: string; value: string };
type Stat = { label: string; value: string };
type Answer = {
  headline: string;
  summary: string;
  stats: Stat[];
  evidence: EvidenceRow[];
  action?: string;
  actionDetail?: string;
};
type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  answer?: Answer;
};
type SelectedModule = { label: string; snapshot: string };

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
      summary: t("AvalAssistant.answerNoiSummary"),
      stats: [{ label: t("AvalAssistant.answerNoiStat1"), value: "MX$286,410" }, { label: t("AvalAssistant.answerNoiStat2"), value: "+4.8%" }, { label: t("AvalAssistant.answerNoiStat3"), value: "MX$438,900" }],
      evidence: [{ label: t("AvalAssistant.answerNoiEvidence1"), value: "+MX$18,600" }, { label: t("AvalAssistant.answerNoiEvidence2"), value: "−MX$7,200" }, { label: t("AvalAssistant.answerNoiEvidence3"), value: "+MX$4,100" }],
      action: t("AvalAssistant.answerNoiAction"),
      actionDetail: t("AvalAssistant.answerNoiActionDetail"),
    };
  }
  if (/data coverage|cobertura de datos|source|fuente/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerCoverageHeadline"),
      summary: t("AvalAssistant.answerCoverageSummary"),
      stats: [{ label: t("AvalAssistant.answerCoverageStat1"), value: "2" }, { label: t("AvalAssistant.answerCoverageStat2"), value: "0" }, { label: t("AvalAssistant.answerCoverageStat3"), value: "1" }],
      evidence: [{ label: t("AvalAssistant.answerCoverageEvidence1"), value: "QuickBooks or Xero" }, { label: t("AvalAssistant.answerCoverageEvidence2"), value: "AppFolio, Buildium, or PMS" }, { label: t("AvalAssistant.answerCoverageEvidence3"), value: "Optional" }],
      action: t("AvalAssistant.answerCoverageAction"),
      actionDetail: t("AvalAssistant.answerCoverageActionDetail"),
    };
  }
  if (/lead-to-lease|funnel|embudo|prospecto|contacted|contactados/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerFunnelHeadline"),
      summary: t("AvalAssistant.answerFunnelSummary"),
      stats: [{ label: t("AvalAssistant.answerFunnelStat1"), value: "148" }, { label: t("AvalAssistant.answerFunnelStat2"), value: "82" }, { label: t("AvalAssistant.answerFunnelStat3"), value: "21" }],
      evidence: [{ label: t("AvalAssistant.answerFunnelEvidence1"), value: "55.4%" }, { label: t("AvalAssistant.answerFunnelEvidence2"), value: "45.1%" }, { label: t("AvalAssistant.answerFunnelEvidence3"), value: "56.8%" }],
      action: t("AvalAssistant.answerFunnelAction"),
      actionDetail: t("AvalAssistant.answerFunnelActionDetail"),
    };
  }
  if (/collect|rent|delinquen|payment|cobran|renta|pago|moros/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerCollectionsHeadline"),
      summary: t("AvalAssistant.answerCollectionsSummary"),
      stats: [{ label: t("AvalAssistant.answerCollectionsStat1"), value: "92.6%" }, { label: t("AvalAssistant.answerCollectionsStat2"), value: "MX$28,500" }, { label: t("AvalAssistant.answerCollectionsStat3"), value: "3 of 84" }],
      evidence: [{ label: t("AvalAssistant.answerCollectionsEvidence1"), value: "38 days · MX$12,000" }, { label: t("AvalAssistant.answerCollectionsEvidence2"), value: "Promise broken · MX$9,500" }, { label: t("AvalAssistant.answerCollectionsEvidence3"), value: "32 days · MX$7,000" }],
      action: t("AvalAssistant.answerCollectionsAction"),
      actionDetail: t("AvalAssistant.answerCollectionsActionDetail"),
    };
  }
  if (/maintenance|work order|repair|ticket|mantenimiento|reparaci|orden/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerMaintenanceHeadline"),
      summary: t("AvalAssistant.answerMaintenanceSummary"),
      stats: [{ label: t("AvalAssistant.answerMaintenanceStat1"), value: "18" }, { label: t("AvalAssistant.answerMaintenanceStat2"), value: "4" }, { label: t("AvalAssistant.answerMaintenanceStat3"), value: "3h" }],
      evidence: [{ label: t("AvalAssistant.answerMaintenanceEvidence1"), value: "Active leak · 3h" }, { label: t("AvalAssistant.answerMaintenanceEvidence2"), value: "No hot water · 7h" }, { label: t("AvalAssistant.answerMaintenanceEvidence3"), value: "Lighting · 11h" }],
      action: t("AvalAssistant.answerMaintenanceAction"),
      actionDetail: t("AvalAssistant.answerMaintenanceActionDetail"),
    };
  }
  if (/vacan|leasing|lease|occup|unit|arrend|ocup|unidad/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerVacancyHeadline"),
      summary: t("AvalAssistant.answerVacancySummary"),
      stats: [{ label: t("AvalAssistant.answerVacancyStat1"), value: "94.2%" }, { label: t("AvalAssistant.answerVacancyStat2"), value: "5" }, { label: t("AvalAssistant.answerVacancyStat3"), value: "MX$41,200" }],
      evidence: [{ label: t("AvalAssistant.answerVacancyEvidence1"), value: "31 days · +9.1% vs comps" }, { label: t("AvalAssistant.answerVacancyEvidence2"), value: "27 days · +7.3% vs comps" }],
      action: t("AvalAssistant.answerVacancyAction"),
      actionDetail: t("AvalAssistant.answerVacancyActionDetail"),
    };
  }
  if (/today|attention|priority|risk|hoy|atenci|prioridad|riesgo/.test(normalized)) {
    return {
      headline: t("AvalAssistant.answerTodayHeadline"),
      summary: t("AvalAssistant.answerTodaySummary"),
      stats: [{ label: t("AvalAssistant.answerTodayStat1"), value: "MX$28,500" }, { label: t("AvalAssistant.answerTodayStat2"), value: "4" }, { label: t("AvalAssistant.answerTodayStat3"), value: "MX$41,200" }],
      evidence: [{ label: t("AvalAssistant.answerTodayEvidence1"), value: "3 reachable accounts" }, { label: t("AvalAssistant.answerTodayEvidence2"), value: "SLA breach in 3h" }, { label: t("AvalAssistant.answerTodayEvidence3"), value: "27–31 days" }],
      action: t("AvalAssistant.answerTodayAction"),
      actionDetail: t("AvalAssistant.answerTodayActionDetail"),
    };
  }

  const currentViewKey = viewNameKeys[view] ?? viewNameKeys.overview;
  const subject = selectedModule ? t("AvalAssistant.generalSubjectModule", { label: selectedModule.label }) : t(currentViewKey);
  return {
    headline: t("AvalAssistant.answerGeneralHeadlineModule", { subject }),
    summary: t("AvalAssistant.answerGeneralSummary"),
    stats: [
      { label: t("AvalAssistant.answerGeneralStat1"), value: "142" },
      { label: t("AvalAssistant.answerGeneralStat2"), value: "6" },
      { label: t("AvalAssistant.answerGeneralStat3"), value: "3" },
    ],
    evidence: [
      { label: t("AvalAssistant.answerGeneralEvidence1"), value: t("AvalAssistant.dataFreshness4MinAgo") },
      { label: t("AvalAssistant.answerGeneralEvidence2"), value: "Acme Residential" },
    ],
  };
}

export function AvalAssistant({ view }: { view: string }) {
  const { notify } = useExperience();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pickingModule, setPickingModule] = useState(false);
  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);
  const [prepared, setPrepared] = useState<Record<number, boolean>>({});
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
  const timer = useRef<number | null>(null);
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
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [pickingModule]);

  const submitQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || thinking) return;
    const focusedModule = selectedModule;
    const userMessage: ChatMessage = { id: nextId.current++, role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setThinking(true);
    timer.current = window.setTimeout(() => {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", answer: analyzeQuestion(t, trimmed, view, focusedModule) }]);
      setThinking(false);
      timer.current = null;
    }, 520);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitQuestion(input);
  };

  const prepareAction = (message: ChatMessage) => {
    if (!message.answer?.action) return;
    setPrepared((current) => ({ ...current, [message.id]: true }));
    notify(t("AvalAssistant.actionPreparedForReview"), message.answer.actionDetail ?? message.answer.action);
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
              <span className="aval-assistant-mark" aria-hidden="true" />
              <span><strong>{t("AvalAssistant.askAval")}</strong><small><i />{t("AvalAssistant.liveDashboardContext")}</small></span>
            </div>
            <button className="aval-assistant-close" type="button" onClick={closeAssistant} aria-label={t("AvalAssistant.closeAssistant")}><Xmark width={19} height={19} /></button>
          </header>

          <div className="aval-assistant-context">
            <div className="aval-chat-context-row">
              <span className="aval-chat-scope"><Database width={15} height={15} /><span>{currentContext}</span><span>·</span><span>Acme Residential</span></span>
              <button className={`aval-module-picker ${pickingModule ? "active" : ""}`} type="button" onClick={() => setPickingModule((current) => !current)} aria-pressed={pickingModule}>
                <ViewGrid width={15} height={15} />{selectedModule ? t("AvalAssistant.changeModule") : t("AvalAssistant.selectModule")}
              </button>
            </div>
            {pickingModule && <p className="aval-module-picker-instruction"><span />{t("AvalAssistant.hoverOverADashboardModuleThen")}</p>}
            {selectedModule && (
              <div className="aval-selected-module-context">
                <ViewGrid width={16} height={16} />
                <span><small>{t("AvalAssistant.focusedModule")}</small><strong>{selectedModule.label}</strong></span>
                <button type="button" onClick={clearSelectedModule} aria-label={t("AvalAssistant.clearSelectedModule")}><Xmark width={15} height={15} /></button>
              </div>
            )}
          </div>

          <div className="aval-assistant-stream" ref={streamRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`aval-chat-message ${message.role}`} key={message.id}>
                {message.text && <p>{message.text}</p>}
                {message.answer && (
                  <div className="aval-chat-answer">
                    <div className="aval-chat-answer-heading"><StatsUpSquare width={18} height={18} /><strong>{message.answer.headline}</strong></div>
                    <p>{message.answer.summary}</p>
                    <div className="aval-chat-stats">
                      {message.answer.stats.map((stat) => <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>)}
                    </div>
                    <details className="aval-chat-evidence">
                      <summary>{t("AvalAssistant.viewEvidence")}<NavArrowRight width={15} height={15} /></summary>
                      <div>{message.answer.evidence.map((row) => <span key={row.label}><small>{row.label}</small><strong>{row.value}</strong></span>)}</div>
                      <p><CheckCircle width={14} height={14} />{t("AvalAssistant.calculatedFromTheDashboardSnapshotUpdated")}</p>
                    </details>
                    {message.answer.action && (
                      <button className="aval-chat-action" type="button" disabled={prepared[message.id]} onClick={() => prepareAction(message)}>
                        {prepared[message.id] ? <CheckCircle width={17} height={17} /> : <SendDiagonal width={17} height={17} />}
                        <span><strong>{prepared[message.id] ? t("AvalAssistant.preparedForReview") : message.answer.action}</strong><small>{message.answer.actionDetail ?? message.answer.action}</small></span>
                        {!prepared[message.id] && <NavArrowRight width={17} height={17} />}
                      </button>
                    )}
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
