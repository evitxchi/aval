"use client";
/* eslint-disable @next/next/no-html-link-for-pages, jsx-a11y/no-autofocus */

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bell, Check, CheckCircle, ChatLines, HalfMoon, HomeSimpleDoor, Language,
  NavArrowLeft, NavArrowRight, Plus, SendDiagonal, Settings, SoundHigh,
  SoundOff, SunLight, TaskList, Xmark,
} from "iconoir-react";
import { siApple, siQuickbooks, siWhatsapp } from "simple-icons";
import { AnimatedNumber, ExperienceProvider, useExperience } from "@/app/components/experience";
import { useRouter, usePathname } from "../navigation";
import "./mobile.css";

type Tab = "home" | "tasks" | "inbox" | "profile";
const channels = { whatsapp: siWhatsapp, apple: siApple, quickbooks: siQuickbooks };

function AppIcon({ id }: { id: keyof typeof channels | "slack" }) {
  if (id === "slack") return <span className="mobile-app-icon"><svg viewBox="0 0 24 24" role="img" aria-label="Slack"><path fill="#36C5F0" d="M5.2 0a2.4 2.4 0 0 0 0 4.8h2.4V2.4A2.4 2.4 0 0 0 5.2 0m0 6.4H2.4a2.4 2.4 0 0 0 0 4.8h2.8z"/><path fill="#2EB67D" d="M24 5.2a2.4 2.4 0 0 0-4.8 0v2.4h2.4A2.4 2.4 0 0 0 24 5.2m-6.4 0V2.4a2.4 2.4 0 0 0-4.8 0v2.8z"/><path fill="#ECB22E" d="M18.8 24a2.4 2.4 0 0 0 0-4.8h-2.4v2.4a2.4 2.4 0 0 0 2.4 2.4m0-6.4h2.8a2.4 2.4 0 0 0 0-4.8h-2.8z"/><path fill="#E01E5A" d="M0 18.8a2.4 2.4 0 0 0 4.8 0v-2.4H2.4A2.4 2.4 0 0 0 0 18.8m6.4 0v2.8a2.4 2.4 0 0 0 4.8 0v-2.8z"/></svg></span>;
  const icon = channels[id];
  return <span className="mobile-app-icon"><svg viewBox="0 0 24 24" role="img" aria-label={icon.title}><path fill={`#${icon.hex}`} d={icon.path}/></svg></span>;
}

type MobileTask = { id: number; title: string; detail: string; channel: keyof typeof channels | "slack"; urgent: boolean };
const initialMobileTasks: MobileTask[] = [
  { id: 1, title: "Approve payment-plan reply", detail: "Diana Ortiz · 12 days past due", channel: "whatsapp", urgent: true },
  { id: 2, title: "Confirm tomorrow's viewing", detail: "Marcus Lee · Franklin House 4B", channel: "apple", urgent: false },
  { id: 3, title: "Reconcile unmatched deposit", detail: "August operating account", channel: "quickbooks", urgent: false },
];

function MobileApp() {
  const { theme, setTheme, sounds, setSounds, notify, celebrate } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const switchLocale = (nextLocale: "en" | "es-mx") => router.replace(pathname, { locale: nextLocale });
  const [tab, setTab] = useState<Tab>("home");
  const [done, setDone] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState(["Tomorrow at three works perfectly."]);
  const [installEvent, setInstallEvent] = useState<Event & { prompt?: () => Promise<void> }>();
  const [tasks, setTasks] = useState<MobileTask[]>(initialMobileTasks);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const createTask = (event: FormEvent) => {
    event.preventDefault();
    if (!taskDraft.trim()) return;
    setTasks((current) => [{ id: Date.now(), title: taskDraft.trim(), detail: t("MobileApp.createdByCamilaJustNow"), channel: "slack", urgent: false }, ...current]);
    notify(t("MobileApp.taskCreated"), taskDraft.trim());
    setTaskDraft("");
    setCreatingTask(false);
  };
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallEvent(event as Event & { prompt?: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  const send = () => { if (!message.trim()) return; setThread((items) => [...items, message.trim()]); setMessage(""); notify(t("MobileApp.messageSent"), "Apple Messages"); };
  const install = async () => { if (installEvent?.prompt) { await installEvent.prompt(); setInstallEvent(undefined); } else notify(t("MobileApp.installAval"), t("MobileApp.useAddToHomeScreenIn")); };
  const title = useMemo(() => ({ home: t("MobileApp.today"), tasks: t("MobileApp.tasks"), inbox: t("MobileApp.inbox"), profile: t("MobileApp.profile") })[tab], [t, tab]);
  return <main className="mobile-shell" data-workspace-mode="demo"><div className="demo-mode-banner"><span><strong>{t("DemoMode.badge")}</strong><span>{t("DemoMode.banner")}</span></span><a href={`/${currentLocale}?data=live`}>{t("DemoMode.exit")}</a></div><header className="mobile-header"><div><img className="mobile-logo" src="/brand/aval-mark.png" alt="Aval"/><span><small>{t("MobileApp.acmeResidential")}</small><strong>{title}</strong></span></div><button onClick={() => setNotificationsOpen(true)}><Bell width={21} height={21}/><i/></button></header><div className="mobile-content">
    {tab === "home" && <><section className="mobile-greeting" data-reveal><p>{t("MobileApp.goodMorningCamila")}</p><h1>{t("MobileApp.thePortfolioIsCalmOneDecision")}</h1></section><section className="mobile-metrics" data-reveal><article><span>{t("MobileApp.collected")}</span><strong><AnimatedNumber value={612800} prefix="$"/></strong><small>92.6% {t("MobileApp.ofBilling")}</small></article><article><span>{t("MobileApp.occupancy")}</span><strong><AnimatedNumber value={94.2} suffix="%" decimals={1}/></strong><small>+1.2% {t("MobileApp.thisMonth")}</small></article><article><span>{t("MobileApp.openWork")}</span><strong><AnimatedNumber value={18}/></strong><small>4 {t("MobileApp.urgent")}</small></article></section><section className="mobile-section" data-reveal><div className="mobile-section-title"><h2>{t("MobileApp.needsYou")}</h2><button onClick={() => setTab("tasks")}>{t("MobileApp.seeAll")}<NavArrowRight width={16} height={16}/></button></div><article className="mobile-focus-card"><div><AppIcon id="whatsapp"/><span><small>{t("MobileApp.approval")} · 9 min</small><strong>Approve payment-plan reply</strong><p>Diana Ortiz · Monroe Court 2A</p></span></div><button onClick={() => { setDone((ids) => [...ids, 1]); celebrate(t("MobileApp.approved"), "Reply sent through WhatsApp"); }}><Check width={18} height={18}/>{done.includes(1) ? t("MobileApp.approved") : t("MobileApp.reviewApprove")}</button></article></section><section className="mobile-section" data-reveal><div className="mobile-section-title"><h2>{t("MobileApp.avalNow")}</h2></div><div className="mobile-activity"><AppIcon id="slack"/><span><strong>{t("MobileApp.portfolioTeamApprovedTheNextStep")}</strong><small>{t("MobileApp.notifSlackDetail", { minutes: 4 })}</small></span></div><div className="mobile-activity"><AppIcon id="quickbooks"/><span><strong>{t("MobileApp.augustCollectionReached926")}</strong><small>{t("MobileApp.notifQuickbooksDetail", { minutes: 18 })}</small></span></div></section></>}
    {tab === "tasks" && <section className="mobile-list-view"><div className="mobile-page-title"><h1>{t("MobileApp.fieldReadyWork")}</h1><button onClick={() => setCreatingTask(true)}><Plus width={20} height={20}/></button></div>{tasks.map((task) => <article className={`mobile-task ${done.includes(task.id) ? "done" : ""}`} data-reveal key={task.id}><AppIcon id={task.channel}/><span><small>{task.urgent ? t("MobileApp.needsApproval") : t("MobileApp.inProgress")}</small><strong>{task.title}</strong><p>{task.detail}</p></span><button onClick={() => { if (!done.includes(task.id)) { setDone((ids) => [...ids, task.id]); celebrate(t("MobileApp.taskComplete"), task.title); } }}><CheckCircle width={24} height={24}/></button></article>)}</section>}
    {tab === "inbox" && <section className="mobile-thread"><div className="mobile-contact"><AppIcon id="apple"/><span><strong>Marcus Lee</strong><small>Franklin House · 4B</small></span></div><div className="mobile-bubbles"><p className="received">Hi, I had a question about the next step.</p><p className="sent">The viewing is held for tomorrow at 3pm.</p>{thread.map((item, index) => <p className={index === 0 ? "received" : "sent"} key={`${item}-${index}`}>{item}</p>)}</div><footer><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={t("MobileApp.messageMarcus")}/><button onClick={send}><SendDiagonal width={19} height={19}/></button></footer></section>}
    {tab === "profile" && <section className="mobile-settings"><div className="mobile-profile"><span>CR</span><h1>Camila Reyes</h1><p>Acme Residential · Administrator</p></div><div className="mobile-setting"><div><Language width={20} height={20}/><span><strong>{t("MobileApp.language")}</strong><small>English / Español LatAm</small></span></div><div className="mobile-segment"><button className={currentLocale === "en" ? "active" : ""} onClick={() => switchLocale("en")}>EN</button><button className={currentLocale === "es-mx" ? "active" : ""} onClick={() => switchLocale("es-mx")}>ES-MX</button></div></div><div className="mobile-setting"><div>{theme === "light" ? <SunLight width={20} height={20}/> : <HalfMoon width={20} height={20}/>}<span><strong>{t("MobileApp.appearance")}</strong><small>{t("MobileApp.lightAndInvertedDark")}</small></span></div><button className="mobile-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")}><i className={theme === "dark" ? "on" : ""}/></button></div><div className="mobile-setting"><div>{sounds ? <SoundHigh width={20} height={20}/> : <SoundOff width={20} height={20}/>}<span><strong>{t("MobileApp.tactileSounds")}</strong><small>{t("MobileApp.optInQuietFeedback")}</small></span></div><button className="mobile-toggle" onClick={() => setSounds(!sounds)}><i className={sounds ? "on" : ""}/></button></div><button className="mobile-install" onClick={install}>{t("MobileApp.installAvalMobile")}<NavArrowRight width={17} height={17}/></button><a className="mobile-desktop-link" href="/"><NavArrowLeft width={16} height={16}/>{t("MobileApp.openDesktopWorkspace")}</a></section>}
  </div><nav className="mobile-tabs">{([{ id: "home", labelKey: "MobileApp.tabHome", Icon: HomeSimpleDoor }, { id: "tasks", labelKey: "MobileApp.tabTasks", Icon: TaskList }, { id: "inbox", labelKey: "MobileApp.tabInbox", Icon: ChatLines }, { id: "profile", labelKey: "MobileApp.tabProfile", Icon: Settings }] as const).map(({ id, labelKey, Icon }) => <button className={tab === id ? "active" : ""} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} key={id}><Icon width={21} height={21}/><span>{t(labelKey)}</span></button>)}</nav>

  <Dialog.Root open={notificationsOpen} onOpenChange={setNotificationsOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay"/>
      <Dialog.Content className="small-dialog">
        <div className="dialog-top"><Dialog.Title>{t("MobileApp.notificationsTitle")}</Dialog.Title><Dialog.Close className="icon-button"><Xmark width={20} height={20}/></Dialog.Close></div>
        <div className="mobile-activity"><AppIcon id="whatsapp"/><span><strong>Approve payment-plan reply</strong><small>{t("MobileApp.notifApprovalDetail", { minutes: 9 })}</small></span></div>
        <div className="mobile-activity"><AppIcon id="slack"/><span><strong>{t("MobileApp.portfolioTeamApprovedTheNextStep")}</strong><small>{t("MobileApp.notifSlackDetail", { minutes: 4 })}</small></span></div>
        <div className="mobile-activity"><AppIcon id="quickbooks"/><span><strong>{t("MobileApp.augustCollectionReached926")}</strong><small>{t("MobileApp.notifQuickbooksDetail", { minutes: 18 })}</small></span></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  <Dialog.Root open={creatingTask} onOpenChange={setCreatingTask}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay"/>
      <Dialog.Content className="small-dialog">
        <Dialog.Title>{t("MobileApp.newTaskTitle")}</Dialog.Title>
        <form onSubmit={createTask}>
          <label>{t("MobileApp.whatNeedsToHappen")}<textarea autoFocus value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder={t("MobileApp.describeTheOutcome")}/></label>
          <div className="dialog-actions">
            <Dialog.Close className="soft-button">{t("MobileApp.cancel")}</Dialog.Close>
            <button className="primary-button" type="submit">{t("MobileApp.createTask")}</button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  </main>;
}

export default function MobilePage() { return <ExperienceProvider><MobileApp/></ExperienceProvider>; }
