"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useState } from "react";
import {
  Bell, Check, CheckCircle, ChatLines, HalfMoon, HomeSimpleDoor, Language,
  NavArrowLeft, NavArrowRight, Plus, SendDiagonal, Settings, SoundHigh,
  SoundOff, SunLight, TaskList,
} from "iconoir-react";
import { siApple, siQuickbooks, siWhatsapp } from "simple-icons";
import { AnimatedNumber, ExperienceProvider, useExperience } from "@/app/components/experience";
import "./mobile.css";

type Tab = "home" | "tasks" | "inbox" | "profile";
const channels = { whatsapp: siWhatsapp, apple: siApple, quickbooks: siQuickbooks };

function AppIcon({ id }: { id: keyof typeof channels | "slack" }) {
  if (id === "slack") return <span className="mobile-app-icon"><svg viewBox="0 0 24 24" role="img" aria-label="Slack"><path fill="#36C5F0" d="M5.2 0a2.4 2.4 0 0 0 0 4.8h2.4V2.4A2.4 2.4 0 0 0 5.2 0m0 6.4H2.4a2.4 2.4 0 0 0 0 4.8h2.8z"/><path fill="#2EB67D" d="M24 5.2a2.4 2.4 0 0 0-4.8 0v2.4h2.4A2.4 2.4 0 0 0 24 5.2m-6.4 0V2.4a2.4 2.4 0 0 0-4.8 0v2.8z"/><path fill="#ECB22E" d="M18.8 24a2.4 2.4 0 0 0 0-4.8h-2.4v2.4a2.4 2.4 0 0 0 2.4 2.4m0-6.4h2.8a2.4 2.4 0 0 0 0-4.8h-2.8z"/><path fill="#E01E5A" d="M0 18.8a2.4 2.4 0 0 0 4.8 0v-2.4H2.4A2.4 2.4 0 0 0 0 18.8m6.4 0v2.8a2.4 2.4 0 0 0 4.8 0v-2.8z"/></svg></span>;
  const icon = channels[id];
  return <span className="mobile-app-icon"><svg viewBox="0 0 24 24" role="img" aria-label={icon.title}><path fill={`#${icon.hex}`} d={icon.path}/></svg></span>;
}

const mobileTasks = [
  { id: 1, title: "Approve payment-plan reply", detail: "Diana Ortiz · 12 days past due", channel: "whatsapp" as const, urgent: true },
  { id: 2, title: "Confirm tomorrow's viewing", detail: "Marcus Lee · Franklin House 4B", channel: "apple" as const, urgent: false },
  { id: 3, title: "Reconcile unmatched deposit", detail: "August operating account", channel: "quickbooks" as const, urgent: false },
];

function MobileApp() {
  const { copy, locale, setLocale, theme, setTheme, sounds, setSounds, notify, celebrate } = useExperience();
  const [tab, setTab] = useState<Tab>("home");
  const [done, setDone] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState(["Tomorrow at three works perfectly."]);
  const [installEvent, setInstallEvent] = useState<Event & { prompt?: () => Promise<void> }>();
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallEvent(event as Event & { prompt?: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  const send = () => { if (!message.trim()) return; setThread((items) => [...items, message.trim()]); setMessage(""); notify(copy("Message sent", "Mensaje enviado"), "Apple Messages"); };
  const install = async () => { if (installEvent?.prompt) { await installEvent.prompt(); setInstallEvent(undefined); } else notify(copy("Install Portero", "Instalar Portero"), copy("Use Add to Home Screen in your browser menu.", "Usa Agregar a pantalla de inicio en el menú del navegador.")); };
  const title = useMemo(() => ({ home: copy("Today", "Hoy"), tasks: copy("Tasks", "Tareas"), inbox: copy("Inbox", "Bandeja"), profile: copy("Profile", "Perfil") })[tab], [copy, tab]);
  return <main className="mobile-shell"><header className="mobile-header"><div><span className="mobile-logo">p</span><span><small>{copy("Acme Residential", "Acme Residencial")}</small><strong>{title}</strong></span></div><button onClick={() => notify(copy("Notifications", "Notificaciones"), copy("Three updates, one needs approval.", "Tres avisos; uno requiere aprobación."))}><Bell width={21} height={21}/><i/></button></header><div className="mobile-content">
    {tab === "home" && <><section className="mobile-greeting" data-reveal><p>{copy("Good morning, Camila", "Buenos días, Camila")}</p><h1>{copy("The portfolio is calm. One decision needs you.", "El portafolio está tranquilo. Una decisión te necesita.")}</h1></section><section className="mobile-metrics" data-reveal><article><span>{copy("Collected", "Cobrado")}</span><strong><AnimatedNumber value={612800} prefix="$"/></strong><small>92.6% {copy("of billing", "de facturación")}</small></article><article><span>{copy("Occupancy", "Ocupación")}</span><strong><AnimatedNumber value={94.2} suffix="%" decimals={1}/></strong><small>+1.2% {copy("this month", "este mes")}</small></article><article><span>{copy("Open work", "Trabajo abierto")}</span><strong><AnimatedNumber value={18}/></strong><small>4 {copy("urgent", "urgentes")}</small></article></section><section className="mobile-section" data-reveal><div className="mobile-section-title"><h2>{copy("Needs you", "Te necesita")}</h2><button onClick={() => setTab("tasks")}>{copy("See all", "Ver todo")}<NavArrowRight width={16} height={16}/></button></div><article className="mobile-focus-card"><div><AppIcon id="whatsapp"/><span><small>{copy("Approval", "Aprobación")} · 9 min</small><strong>Approve payment-plan reply</strong><p>Diana Ortiz · Monroe Court 2A</p></span></div><button onClick={() => { setDone((ids) => [...ids, 1]); celebrate(copy("Approved", "Aprobado"), "Reply sent through WhatsApp"); }}><Check width={18} height={18}/>{done.includes(1) ? copy("Approved", "Aprobado") : copy("Review & approve", "Revisar y aprobar")}</button></article></section><section className="mobile-section" data-reveal><div className="mobile-section-title"><h2>{copy("Portero, now", "Portero, ahora")}</h2></div><div className="mobile-activity"><AppIcon id="slack"/><span><strong>{copy("Portfolio team approved the next step", "El equipo aprobó el siguiente paso")}</strong><small>Slack · #operations · 4 min</small></span></div><div className="mobile-activity"><AppIcon id="quickbooks"/><span><strong>{copy("August collection reached 92.6%", "La cobranza de agosto llegó a 92.6%")}</strong><small>QuickBooks · 18 min</small></span></div></section></>}
    {tab === "tasks" && <section className="mobile-list-view"><div className="mobile-page-title"><h1>{copy("Field-ready work", "Trabajo listo para campo")}</h1><button onClick={() => notify(copy("New task", "Nueva tarea"), copy("Voice capture is ready.", "La captura por voz está lista."))}><Plus width={20} height={20}/></button></div>{mobileTasks.map((task) => <article className={`mobile-task ${done.includes(task.id) ? "done" : ""}`} data-reveal key={task.id}><AppIcon id={task.channel}/><span><small>{task.urgent ? copy("Needs approval", "Necesita aprobación") : copy("In progress", "En progreso")}</small><strong>{task.title}</strong><p>{task.detail}</p></span><button onClick={() => { if (!done.includes(task.id)) { setDone((ids) => [...ids, task.id]); celebrate(copy("Task complete", "Tarea completada"), task.title); } }}><CheckCircle width={24} height={24}/></button></article>)}</section>}
    {tab === "inbox" && <section className="mobile-thread"><div className="mobile-contact"><AppIcon id="apple"/><span><strong>Marcus Lee</strong><small>Franklin House · 4B</small></span></div><div className="mobile-bubbles"><p className="received">Hi, I had a question about the next step.</p><p className="sent">The viewing is held for tomorrow at 3pm.</p>{thread.map((item, index) => <p className={index === 0 ? "received" : "sent"} key={`${item}-${index}`}>{item}</p>)}</div><footer><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={copy("Message Marcus…", "Mensaje a Marcus…")}/><button onClick={send}><SendDiagonal width={19} height={19}/></button></footer></section>}
    {tab === "profile" && <section className="mobile-settings"><div className="mobile-profile"><span>CR</span><h1>Camila Reyes</h1><p>Acme Residential · Administrator</p></div><div className="mobile-setting"><div><Language width={20} height={20}/><span><strong>{copy("Language", "Idioma")}</strong><small>English / Español LatAm</small></span></div><div className="mobile-segment"><button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button><button className={locale === "latam" ? "active" : ""} onClick={() => setLocale("latam")}>LATAM</button></div></div><div className="mobile-setting"><div>{theme === "light" ? <SunLight width={20} height={20}/> : <HalfMoon width={20} height={20}/>}<span><strong>{copy("Appearance", "Apariencia")}</strong><small>{copy("Light and inverted dark", "Claro y oscuro invertido")}</small></span></div><button className="mobile-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")}><i className={theme === "dark" ? "on" : ""}/></button></div><div className="mobile-setting"><div>{sounds ? <SoundHigh width={20} height={20}/> : <SoundOff width={20} height={20}/>}<span><strong>{copy("Tactile sounds", "Sonidos táctiles")}</strong><small>{copy("Opt-in, quiet feedback", "Respuesta discreta opcional")}</small></span></div><button className="mobile-toggle" onClick={() => setSounds(!sounds)}><i className={sounds ? "on" : ""}/></button></div><button className="mobile-install" onClick={install}>{copy("Install Portero Mobile", "Instalar Portero Mobile")}<NavArrowRight width={17} height={17}/></button><a className="mobile-desktop-link" href="/"><NavArrowLeft width={16} height={16}/>{copy("Open desktop workspace", "Abrir espacio de escritorio")}</a></section>}
  </div><nav className="mobile-tabs">{([{ id: "home", label: ["Home", "Inicio"], Icon: HomeSimpleDoor }, { id: "tasks", label: ["Tasks", "Tareas"], Icon: TaskList }, { id: "inbox", label: ["Inbox", "Bandeja"], Icon: ChatLines }, { id: "profile", label: ["Profile", "Perfil"], Icon: Settings }] as const).map(({ id, label, Icon }) => <button className={tab === id ? "active" : ""} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} key={id}><Icon width={21} height={21}/><span>{copy(label[0], label[1])}</span></button>)}</nav></main>;
}

export default function MobilePage() { return <ExperienceProvider><MobileApp/></ExperienceProvider>; }
