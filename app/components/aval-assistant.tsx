"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatLines, CheckCircle, Database, NavArrowRight, SendDiagonal, StatsUpSquare, ViewGrid, Xmark } from "iconoir-react";
import { useExperience } from "@/app/components/experience";

type Pair = readonly [string, string];
type EvidenceRow = { label: Pair; value: string };
type Stat = { label: Pair; value: string };
type Answer = {
  headline: Pair;
  summary: Pair;
  stats: Stat[];
  evidence: EvidenceRow[];
  action?: Pair;
  actionDetail?: Pair;
};
type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  textPair?: Pair;
  answer?: Answer;
};
type SelectedModule = { label: string; snapshot: string };

const viewNames: Record<string, Pair> = {
  overview: ["Portfolio overview", "Resumen del portafolio"],
  tasks: ["Aval tasks", "Tareas de Aval"],
  inbox: ["Shared inbox", "Bandeja compartida"],
  properties: ["Properties", "Propiedades"],
  leasing: ["Leasing", "Arrendamiento"],
  maintenance: ["Maintenance", "Mantenimiento"],
  accounting: ["Accounting", "Contabilidad"],
  connections: ["Connections", "Conexiones"],
  documents: ["Documents", "Documentos"],
  settings: ["Settings", "Ajustes"],
};

const suggestions: Pair[] = [
  ["What needs my attention today?", "¿Qué necesita mi atención hoy?"],
  ["Why are collections behind?", "¿Por qué está atrasada la cobranza?"],
  ["Which maintenance items are urgent?", "¿Qué mantenimientos son urgentes?"],
];

const focusedSuggestions: Pair[] = [
  ["Analyze this module", "Analiza este módulo"],
  ["Why is this happening?", "¿Por qué está pasando esto?"],
  ["What should I do next?", "¿Qué debería hacer después?"],
];

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

function analyzeQuestion(question: string, view: string, selectedModule: SelectedModule | null): Answer {
  const normalized = `${selectedModule?.label ?? ""} ${selectedModule?.snapshot ?? ""} ${question}`.toLocaleLowerCase();

  if (/net operating income|ingreso operativo neto|\bnoi\b/.test(normalized)) {
    return {
      headline: ["NOI is 4.8% ahead month to date", "El ingreso operativo neto está 4.8% arriba en el mes"],
      summary: [
        "Higher collections and lower turnover expense are offsetting a small increase in emergency maintenance costs.",
        "Una mayor cobranza y menores gastos de rotación compensan un pequeño aumento en mantenimiento de emergencia.",
      ],
      stats: [
        { label: ["Month to date", "Mes a la fecha"], value: "MX$286,410" },
        { label: ["Vs prior period", "Vs periodo anterior"], value: "+4.8%" },
        { label: ["Forecast", "Pronóstico"], value: "MX$438,900" },
      ],
      evidence: [
        { label: ["Collection variance", "Variación de cobranza"], value: "+MX$18,600" },
        { label: ["Turnover expense", "Gasto de rotación"], value: "−MX$7,200" },
        { label: ["Emergency maintenance", "Mantenimiento urgente"], value: "+MX$4,100" },
      ],
      action: ["Open variance review", "Abrir revisión de variaciones"],
      actionDetail: ["Prepare the property-level NOI drivers for manager review.", "Preparar los impulsores del NOI por propiedad para revisión."],
    };
  }

  if (/data coverage|cobertura de datos|source|fuente/.test(normalized)) {
    return {
      headline: ["Two upstream sources still limit confidence", "Dos fuentes de origen aún limitan la confianza"],
      summary: [
        "Accounting and leasing data are not verified yet. Resident-channel activity is available but remains optional for portfolio metrics.",
        "Los datos contables y de arrendamiento aún no están verificados. La actividad de canales de residentes está disponible, pero es opcional para las métricas.",
      ],
      stats: [
        { label: ["Required", "Requeridas"], value: "2" },
        { label: ["Connected", "Conectadas"], value: "0" },
        { label: ["Optional", "Opcionales"], value: "1" },
      ],
      evidence: [
        { label: ["Accounting", "Contabilidad"], value: "QuickBooks or Xero" },
        { label: ["Leasing pipeline", "Embudo de arrendamiento"], value: "AppFolio, Buildium, or PMS" },
        { label: ["Resident channels", "Canales de residentes"], value: "Optional" },
      ],
      action: ["Review required connections", "Revisar conexiones requeridas"],
      actionDetail: ["Open the setup path for the two sources blocking confidence.", "Abrir la configuración de las dos fuentes que bloquean la confianza."],
    };
  }

  if (/lead-to-lease|funnel|embudo|prospecto|contacted|contactados/.test(normalized)) {
    return {
      headline: ["Viewed → applied is the largest funnel loss", "Visita → solicitud es la mayor pérdida del embudo"],
      summary: [
        "Only 45.1% of viewers apply. Roma Sur contributes most of the drop, where follow-up time is about 19 hours slower than the portfolio median.",
        "Solo el 45.1% de quienes visitan presentan solicitud. Roma Sur concentra la mayor caída, con seguimiento unas 19 horas más lento que la mediana.",
      ],
      stats: [
        { label: ["Contacted", "Contactados"], value: "148" },
        { label: ["Viewed", "Visitaron"], value: "82" },
        { label: ["Signed", "Firmaron"], value: "21" },
      ],
      evidence: [
        { label: ["Contacted → viewed", "Contactado → visita"], value: "55.4%" },
        { label: ["Viewed → applied", "Visita → solicitud"], value: "45.1%" },
        { label: ["Applied → signed", "Solicitud → firma"], value: "56.8%" },
      ],
      action: ["Prepare follow-up sequence", "Preparar secuencia de seguimiento"],
      actionDetail: ["Draft a same-day follow-up for the 11 warmest prospects.", "Preparar seguimiento el mismo día para los 11 prospectos más activos."],
    };
  }

  if (/collect|rent|delinquen|payment|cobran|renta|pago|moros/.test(normalized)) {
    return {
      headline: ["Three accounts explain 71% of the collection gap", "Tres cuentas explican el 71% de la brecha de cobranza"],
      summary: [
        "Paseo Norte is the main driver. One resident broke a payment promise yesterday, and all three accounts have a reachable WhatsApp number.",
        "Paseo Norte es el principal origen. Un residente incumplió una promesa de pago ayer y las tres cuentas tienen WhatsApp disponible.",
      ],
      stats: [
        { label: ["Collected", "Cobrado"], value: "92.6%" },
        { label: ["Exposure", "Exposición"], value: "MX$28,500" },
        { label: ["Accounts", "Cuentas"], value: "3 of 84" },
      ],
      evidence: [
        { label: ["Unit 3B · Lucía R.", "Unidad 3B · Lucía R."], value: "38 days · MX$12,000" },
        { label: ["Unit 5A · Mateo S.", "Unidad 5A · Mateo S."], value: "Promise broken · MX$9,500" },
        { label: ["Unit 7C · Nora V.", "Unidad 7C · Nora V."], value: "32 days · MX$7,000" },
      ],
      action: ["Prepare 3 reminders", "Preparar 3 recordatorios"],
      actionDetail: ["Personalized WhatsApp drafts with per-recipient preview.", "Borradores personalizados de WhatsApp con vista previa por destinatario."],
    };
  }

  if (/maintenance|work order|repair|ticket|mantenimiento|reparaci|orden/.test(normalized)) {
    return {
      headline: ["Four work orders are at risk of missing SLA", "Cuatro órdenes de trabajo están en riesgo de incumplir el SLA"],
      summary: [
        "A water leak at Jardines 22 needs human escalation. The other three can be assigned to approved vendors now.",
        "Una fuga de agua en Jardines 22 requiere escalamiento humano. Las otras tres pueden asignarse ahora a proveedores aprobados.",
      ],
      stats: [
        { label: ["Open", "Abiertas"], value: "18" },
        { label: ["At risk", "En riesgo"], value: "4" },
        { label: ["Next breach", "Próximo incumplimiento"], value: "3h" },
      ],
      evidence: [
        { label: ["Jardines 22 · Unit 4A", "Jardines 22 · Unidad 4A"], value: "Active leak · 3h" },
        { label: ["Roma Sur · Unit 2C", "Roma Sur · Unidad 2C"], value: "No hot water · 7h" },
        { label: ["Paseo Norte · Common area", "Paseo Norte · Área común"], value: "Lighting · 11h" },
      ],
      action: ["Prepare vendor assignments", "Preparar asignaciones"],
      actionDetail: ["Escalate the leak and draft three vendor bookings.", "Escalar la fuga y preparar tres reservas con proveedores."],
    };
  }

  if (/vacan|leasing|lease|occup|unit|arrend|ocup|unidad/.test(normalized)) {
    return {
      headline: ["Two ready units have been vacant for 27+ days", "Dos unidades listas llevan más de 27 días vacantes"],
      summary: [
        "Both are in Roma Sur and priced about 8% above comparable signed leases. A pricing review is the highest-leverage next step.",
        "Ambas están en Roma Sur y tienen precios cerca de 8% por encima de contratos comparables. Revisar el precio es el siguiente paso con mayor impacto.",
      ],
      stats: [
        { label: ["Economic occupancy", "Ocupación económica"], value: "94.2%" },
        { label: ["Ready units", "Unidades listas"], value: "5" },
        { label: ["Monthly exposure", "Exposición mensual"], value: "MX$41,200" },
      ],
      evidence: [
        { label: ["Roma Sur · Unit 6B", "Roma Sur · Unidad 6B"], value: "31 days · +9.1% vs comps" },
        { label: ["Roma Sur · Unit 8A", "Roma Sur · Unidad 8A"], value: "27 days · +7.3% vs comps" },
      ],
      action: ["Draft pricing review", "Preparar revisión de precio"],
      actionDetail: ["Create an owner-ready comparison with recommended ranges.", "Crear una comparación para el propietario con rangos recomendados."],
    };
  }

  if (/today|attention|priority|risk|hoy|atenci|prioridad|riesgo/.test(normalized)) {
    return {
      headline: ["Three items deserve attention today", "Tres asuntos necesitan atención hoy"],
      summary: [
        "Collections have the highest immediate recovery value, followed by an urgent leak and two aging vacancies.",
        "La cobranza tiene el mayor valor de recuperación inmediato, seguida por una fuga urgente y dos vacantes prolongadas.",
      ],
      stats: [
        { label: ["Collection risk", "Riesgo de cobranza"], value: "MX$28,500" },
        { label: ["Urgent work orders", "Órdenes urgentes"], value: "4" },
        { label: ["Vacancy exposure", "Exposición por vacancia"], value: "MX$41,200" },
      ],
      evidence: [
        { label: ["1 · Paseo Norte collections", "1 · Cobranza de Paseo Norte"], value: "3 reachable accounts" },
        { label: ["2 · Jardines 22 leak", "2 · Fuga en Jardines 22"], value: "SLA breach in 3h" },
        { label: ["3 · Roma Sur vacancies", "3 · Vacantes en Roma Sur"], value: "27–31 days" },
      ],
      action: ["Prepare today’s action plan", "Preparar el plan de hoy"],
      actionDetail: ["Bundle the approved messages, escalation, and pricing review.", "Agrupar los mensajes, el escalamiento y la revisión de precios."],
    };
  }

  const currentView = viewNames[view] ?? viewNames.overview;
  const subject: Pair = selectedModule
    ? [`the ${selectedModule.label} module`, `el módulo ${selectedModule.label}`]
    : currentView;
  return {
    headline: [`Here’s what stands out in ${subject[0]}`, `Esto es lo más relevante en ${subject[1]}`],
    summary: [
      "The portfolio is stable overall, but collections, maintenance SLA risk, and aging vacancies have executable next steps today.",
      "El portafolio está estable en general, pero la cobranza, el riesgo de SLA y las vacantes prolongadas tienen acciones ejecutables hoy.",
    ],
    stats: [
      { label: ["Units", "Unidades"], value: "142" },
      { label: ["Properties", "Propiedades"], value: "6" },
      { label: ["Priority findings", "Hallazgos prioritarios"], value: "3" },
    ],
    evidence: [
      { label: ["Data freshness", "Actualización de datos"], value: "4 minutes ago" },
      { label: ["Scope", "Alcance"], value: "Acme Residential" },
    ],
  };
}

export function AvalAssistant({ view }: { view: string }) {
  const { copy, locale, notify } = useExperience();
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
      textPair: [
        "I’m connected to this dashboard context. Ask about collections, vacancies, maintenance, or what deserves attention.",
        "Estoy conectado al contexto de este tablero. Pregunta por cobranza, vacantes, mantenimiento o qué necesita atención.",
      ],
    },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const nextId = useRef(2);
  const timer = useRef<number | null>(null);
  const currentContext = useMemo(() => copy(...(viewNames[view] ?? viewNames.overview)), [copy, view]);

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
        textPair: [
          `I’m looking at “${moduleContext.label}” now. Ask what changed, why it happened, or what action to take.`,
          `Ahora estoy analizando “${moduleContext.label}”. Pregunta qué cambió, por qué ocurrió o qué acción tomar.`,
        ],
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
  }, [open, pickingModule]);

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
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", answer: analyzeQuestion(trimmed, view, focusedModule) }]);
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
    notify(copy("Action prepared for review", "Acción preparada para revisión"), copy(...(message.answer.actionDetail ?? message.answer.action)));
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

  const pick = (pair: Pair) => pair[locale === "latam" ? 1 : 0];
  const promptSuggestions = selectedModule ? focusedSuggestions : messages.length === 1 ? suggestions : [];

  return (
    <div className={`aval-assistant ${open ? "is-open" : ""}`}>
      {open && (
        <section className="aval-assistant-panel" role="dialog" aria-label={copy("Aval assistant", "Asistente de Aval")}>
          <header className="aval-assistant-header">
            <div className="aval-assistant-identity">
              <span className="aval-assistant-mark" aria-hidden="true" />
              <span><strong>{copy("Ask Aval", "Pregunta a Aval")}</strong><small><i />{copy("Live dashboard context", "Contexto del tablero en vivo")}</small></span>
            </div>
            <button className="aval-assistant-close" type="button" onClick={closeAssistant} aria-label={copy("Close assistant", "Cerrar asistente")}><Xmark width={19} height={19} /></button>
          </header>

          <div className="aval-assistant-context">
            <div className="aval-chat-context-row">
              <span className="aval-chat-scope"><Database width={15} height={15} /><span>{currentContext}</span><span>·</span><span>Acme Residential</span></span>
              <button className={`aval-module-picker ${pickingModule ? "active" : ""}`} type="button" onClick={() => setPickingModule((current) => !current)} aria-pressed={pickingModule}>
                <ViewGrid width={15} height={15} />{selectedModule ? copy("Change module", "Cambiar módulo") : copy("Select module", "Elegir módulo")}
              </button>
            </div>
            {pickingModule && <p className="aval-module-picker-instruction"><span />{copy("Hover over a dashboard module, then click it", "Pasa sobre un módulo del tablero y haz clic")}</p>}
            {selectedModule && (
              <div className="aval-selected-module-context">
                <ViewGrid width={16} height={16} />
                <span><small>{copy("Focused module", "Módulo enfocado")}</small><strong>{selectedModule.label}</strong></span>
                <button type="button" onClick={clearSelectedModule} aria-label={copy("Clear selected module", "Quitar módulo seleccionado")}><Xmark width={15} height={15} /></button>
              </div>
            )}
          </div>

          <div className="aval-assistant-stream" ref={streamRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`aval-chat-message ${message.role}`} key={message.id}>
                {(message.text || message.textPair) && <p>{message.textPair ? pick(message.textPair) : message.text}</p>}
                {message.answer && (
                  <div className="aval-chat-answer">
                    <div className="aval-chat-answer-heading"><StatsUpSquare width={18} height={18} /><strong>{pick(message.answer.headline)}</strong></div>
                    <p>{pick(message.answer.summary)}</p>
                    <div className="aval-chat-stats">
                      {message.answer.stats.map((stat) => <span key={stat.label[0]}><small>{pick(stat.label)}</small><strong>{stat.value}</strong></span>)}
                    </div>
                    <details className="aval-chat-evidence">
                      <summary>{copy("View evidence", "Ver evidencia")}<NavArrowRight width={15} height={15} /></summary>
                      <div>{message.answer.evidence.map((row) => <span key={row.label[0]}><small>{pick(row.label)}</small><strong>{row.value}</strong></span>)}</div>
                      <p><CheckCircle width={14} height={14} />{copy("Calculated from the dashboard snapshot · updated 4 min ago", "Calculado con el tablero · actualizado hace 4 min")}</p>
                    </details>
                    {message.answer.action && (
                      <button className="aval-chat-action" type="button" disabled={prepared[message.id]} onClick={() => prepareAction(message)}>
                        {prepared[message.id] ? <CheckCircle width={17} height={17} /> : <SendDiagonal width={17} height={17} />}
                        <span><strong>{prepared[message.id] ? copy("Prepared for review", "Preparada para revisión") : pick(message.answer.action)}</strong><small>{pick(message.answer.actionDetail ?? message.answer.action)}</small></span>
                        {!prepared[message.id] && <NavArrowRight width={17} height={17} />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {thinking && <div className="aval-chat-thinking" aria-label={copy("Analyzing dashboard data", "Analizando datos del tablero")}><i /><i /><i /><span>{copy("Analyzing dashboard data", "Analizando datos del tablero")}</span></div>}
          </div>

          {promptSuggestions.length > 0 && (
            <div className="aval-chat-suggestions">
              {promptSuggestions.map((suggestion) => <button type="button" key={suggestion[0]} onClick={() => submitQuestion(pick(suggestion))}>{pick(suggestion)}<NavArrowRight width={15} height={15} /></button>)}
            </div>
          )}

          <form className="aval-chat-composer" onSubmit={onSubmit}>
            <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={selectedModule ? copy(`Ask about ${selectedModule.label}…`, `Pregunta sobre ${selectedModule.label}…`) : copy("Ask about your portfolio…", "Pregunta sobre tu portafolio…")} aria-label={copy("Ask Aval", "Pregunta a Aval")} />
            <button type="submit" disabled={!input.trim() || thinking} aria-label={copy("Send message", "Enviar mensaje")}><SendDiagonal width={18} height={18} /></button>
          </form>
          <p className="aval-chat-disclaimer">{copy("Aval shows its evidence and asks before taking action.", "Aval muestra evidencia y pide aprobación antes de actuar.")}</p>
        </section>
      )}

      <button className="aval-assistant-launcher" type="button" onClick={toggleAssistant} aria-expanded={open} aria-label={open ? copy("Close Aval assistant", "Cerrar asistente de Aval") : copy("Ask Aval", "Pregunta a Aval")}>
        {open ? <Xmark width={22} height={22} /> : <ChatLines width={23} height={23} />}
        {!open && <span aria-hidden="true" />}
      </button>
    </div>
  );
}
