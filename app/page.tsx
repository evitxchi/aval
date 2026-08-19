"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";

type ViewId = "ledger" | "conversations" | "properties" | "maintenance" | "contracts" | "settings";
type Locale = "es" | "en";
type Decision = "approved" | "rejected";

const dictionaries = {
  es: {
    nav: ["Actividad", "Conversaciones", "Propiedades", "Mantenimiento", "Contratos", "Configuración"],
    date: "Martes, 18 de agosto",
    greeting: "Buenas tardes, Camila.",
    activityEyebrow: "Tu agente, ahora",
    attention: "Hoy requiere tu atención",
    live: "En vivo",
    all: "Todo",
    approval: "Por aprobar",
    completed: "Completado",
    approve: "Aprobar",
    edit: "Editar",
    reject: "Rechazar",
    approved: "Aprobado por ti",
    rejected: "Rechazado por ti",
    working: "Portero está trabajando.",
    workingBody: "Atendiendo 12 conversaciones y siguiendo 3 solicitudes de mantenimiento.",
    conversations: "conversaciones",
    pending: "pendientes",
    ask: "Pídele algo a Portero",
    askPlaceholder: "Ej. Recuérdale la renta a los saldos vencidos…",
    recent: "Próximamente",
    overview: "Resumen operativo",
    openInbox: "Abrir bandeja",
    localeName: "Español (México)",
    formal: "Formal · usted",
    newAction: "Nueva acción",
    notifications: "Notificaciones",
    markRead: "Marcar como leídas",
    search: "Buscar",
    conversationsTitle: "Conversaciones",
    inboxSubtitle: "La operación sucede aquí. Portero prepara; tú supervisas.",
    propertiesTitle: "Propiedades",
    maintenanceTitle: "Mantenimiento",
    contractsTitle: "Contratos y documentos",
    settingsTitle: "Configuración de la organización",
    send: "Enviar",
    upload: "Subir documento",
  },
  en: {
    nav: ["Activity", "Conversations", "Properties", "Maintenance", "Contracts", "Settings"],
    date: "Tuesday, August 18",
    greeting: "Good afternoon, Camila.",
    activityEyebrow: "Your agent, now",
    attention: "Needs your attention today",
    live: "Live",
    all: "All",
    approval: "Needs approval",
    completed: "Completed",
    approve: "Approve",
    edit: "Edit",
    reject: "Reject",
    approved: "Approved by you",
    rejected: "Rejected by you",
    working: "Portero is working.",
    workingBody: "Handling 12 conversations and following up on 3 maintenance requests.",
    conversations: "conversations",
    pending: "pending",
    ask: "Ask Portero to do something",
    askPlaceholder: "E.g. Remind every past-due tenant about rent…",
    recent: "Coming up",
    overview: "Operations overview",
    openInbox: "Open inbox",
    localeName: "English (United States)",
    formal: "Formal · usted",
    newAction: "New action",
    notifications: "Notifications",
    markRead: "Mark all read",
    search: "Search",
    conversationsTitle: "Conversations",
    inboxSubtitle: "Operations happen here. Portero prepares; you supervise.",
    propertiesTitle: "Properties",
    maintenanceTitle: "Maintenance",
    contractsTitle: "Contracts & documents",
    settingsTitle: "Organization settings",
    send: "Send",
    upload: "Upload document",
  },
} as const;

const navItems = [
  { id: "ledger" as const, icon: Activity, count: 3 },
  { id: "conversations" as const, icon: MessagesSquare, count: 8 },
  { id: "properties" as const, icon: Building2 },
  { id: "maintenance" as const, icon: Wrench, count: 3 },
  { id: "contracts" as const, icon: FileText },
];

const ledgerItems = [
  {
    id: "PO-2481",
    time: "14:42",
    title: "Responder sobre la cláusula de mascotas",
    resolvedTitle: "Respondió sobre la cláusula de mascotas",
    detail: "Mariana preguntó si puede tener un gato en Mérida 38 · 4B.",
    preview: "Sí, el contrato permite una mascota doméstica con aviso previo…",
    action: "Aprobar respuesta",
    type: "approval",
    avatars: ["P", "MG"],
  },
  {
    id: "PO-2479",
    time: "14:18",
    title: "Programó la visita para mañana a las 15:00",
    resolvedTitle: "Programó la visita para mañana a las 15:00",
    detail: "Iván Salgado · Amores 1120 · 2A",
    preview: "Visita confirmada y agregada al calendario de Daniela.",
    type: "completed",
    avatars: ["P", "IS"],
  },
  {
    id: "PO-2474",
    time: "13:51",
    title: "Despachar a Plomería Rivera · cotización $2,850",
    resolvedTitle: "Despachó a Plomería Rivera por $2,850",
    detail: "Fuga debajo del lavabo · Durango 214 · 6C",
    preview: "Se adjuntaron 3 fotos. Prioridad media · SLA hoy 18:00.",
    action: "Aprobar despacho",
    type: "approval",
    avatars: ["P", "LR"],
  },
  {
    id: "PO-2468",
    time: "12:32",
    title: "Registró pago SPEI de renta por $18,500",
    resolvedTitle: "Registró pago SPEI de renta por $18,500",
    detail: "Alejandro Sáenz · Mérida 38 · 2A",
    preview: "Comprobante cotejado con la referencia de agosto.",
    type: "completed",
    avatars: ["P", "AS"],
  },
] as const;

const conversations = [
  { id: 1, name: "Mariana García", initials: "MG", unit: "Mérida 38 · 4B", message: "¿El contrato permite tener un gato?", time: "14:40", unread: 2, active: true },
  { id: 2, name: "Iván Salgado", initials: "IS", unit: "Amores 1120 · 2A", message: "Perfecto, nos vemos mañana.", time: "14:21", unread: 0 },
  { id: 3, name: "Lucía Rojas", initials: "LR", unit: "Durango 214 · 6C", message: "Le mando fotos de la fuga.", time: "13:48", unread: 3 },
  { id: 4, name: "Alejandro Sáenz", initials: "AS", unit: "Mérida 38 · 2A", message: "Transferencia realizada, gracias.", time: "12:32", unread: 0 },
  { id: 5, name: "Plomería Rivera", initials: "PR", unit: "Contratista · Plomería", message: "Podemos llegar a las 17:30.", time: "11:56", unread: 0 },
];

const properties = [
  { name: "Mérida 38", area: "Roma Norte, CDMX", units: 18, occupied: 17, rent: "$356,500", tag: "Estable" },
  { name: "Amores 1120", area: "Del Valle, CDMX", units: 12, occupied: 11, rent: "$274,000", tag: "1 vacante" },
  { name: "Durango 214", area: "Roma Norte, CDMX", units: 24, occupied: 24, rent: "$498,200", tag: "Completo" },
];

const tickets = [
  { ref: "MAN-0318", title: "Fuga debajo del lavabo", place: "Durango 214 · 6C", tenant: "Lucía Rojas", state: "Por aprobar", sla: "Hoy · 18:00", severity: "Media" },
  { ref: "MAN-0316", title: "Boiler sin encender", place: "Amores 1120 · 3B", tenant: "Ricardo López", state: "En camino", sla: "Hoy · 16:30", severity: "Alta" },
  { ref: "MAN-0312", title: "Interfón sin audio", place: "Mérida 38 · PB1", tenant: "Paola Reyes", state: "Programado", sla: "Mañana · 10:00", severity: "Baja" },
];

const files = [
  { name: "Contrato de arrendamiento · Mérida 38-4B.pdf", meta: "12 páginas · firmado 02/08/2026", status: "Términos extraídos", type: "Contrato" },
  { name: "INE · Mariana García.pdf", meta: "2 páginas · consentimiento vigente", status: "Verificado", type: "Identidad" },
  { name: "Comprobante SPEI · AGO-2026.png", meta: "$18,500.00 · 18/08/2026", status: "Cotejado", type: "Pago" },
  { name: "Póliza jurídica · Amores 1120-2A.pdf", meta: "8 páginas · vence 01/02/2027", status: "Indexado", type: "Garantía" },
];

function AgentOrb({ large = false }: { large?: boolean }) {
  return <span className={`agent-orb ${large ? "large" : ""}`}>p</span>;
}

function AvatarStack({ avatars }: { avatars: readonly string[] }) {
  return <span className="avatar-stack">{avatars.map((avatar, index) => index === 0 ? <AgentOrb key={avatar} /> : <span className="person-orb" key={avatar}>{avatar}</span>)}</span>;
}

function ChannelBadge() {
  return <span className="channel-badge" aria-label="WhatsApp"><MessageCircle size={14} strokeWidth={2.3} /></span>;
}

export default function HomePage() {
  const [view, setView] = useState<ViewId>("ledger");
  const [locale, setLocale] = useState<Locale>("es");
  const [register, setRegister] = useState("formal");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [selectedConversation, setSelectedConversation] = useState(1);
  const [composer, setComposer] = useState("");
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [commandSent, setCommandSent] = useState(false);
  const t = dictionaries[locale];

  const filteredLedger = useMemo(() => ledgerItems.filter((item) => {
    if (ledgerFilter === "approval") return item.type === "approval" && !decisions[item.id];
    if (ledgerFilter === "completed") return item.type === "completed" || Boolean(decisions[item.id]);
    return true;
  }), [ledgerFilter, decisions]);

  const decide = (id: string, decision: Decision) => setDecisions((current) => ({ ...current, [id]: decision }));

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!composer.trim()) return;
    setSentMessages((messages) => [...messages, composer.trim()]);
    setComposer("");
  };

  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!command.trim()) return;
    setCommandSent(true);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <button className="brand-mark" onClick={() => setView("ledger")} aria-label="Portero home">P</button>
        <nav className="nav-stack">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <button className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)} key={item.id}>
                <Icon size={18} strokeWidth={1.7} />
                <b>{t.nav[index]}</b>
                {item.count ? <em>{item.count}</em> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
            <Settings2 size={18} strokeWidth={1.7} /><b>{t.nav[5]}</b>
          </button>
          <div className="profile"><span>CM</span><div><strong>Casa Mérida</strong><small>Ciudad de México</small></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.date}</p>
            <h1>{view === "ledger" ? t.greeting : t.nav[["ledger", "conversations", "properties", "maintenance", "contracts", "settings"].indexOf(view)]}</h1>
          </div>
          <div className="top-actions">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="locale">{t.localeName}<ChevronDown size={13} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={8}>
                  <p className="menu-label">Interface locale</p>
                  <DropdownMenu.RadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                    <DropdownMenu.RadioItem className="menu-item" value="es"><span>Español (México)</span>{locale === "es" && <Check size={15} />}</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem className="menu-item" value="en"><span>English (United States)</span>{locale === "en" && <Check size={15} />}</DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator className="menu-separator" />
                  <p className="menu-label">Conversation register</p>
                  <DropdownMenu.RadioGroup value={register} onValueChange={setRegister}>
                    <DropdownMenu.RadioItem className="menu-item" value="formal"><span>Formal · usted</span>{register === "formal" && <Check size={15} />}</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem className="menu-item" value="neutral"><span>Neutral</span>{register === "neutral" && <Check size={15} />}</DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <Dialog.Root>
              <Dialog.Trigger asChild><button className="icon-button" aria-label={t.notifications}><Bell size={17} /><i /></button></Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="notification-tray">
                  <div className="tray-heading"><div><p className="eyebrow">Portero</p><Dialog.Title>{t.notifications}</Dialog.Title></div><Dialog.Close className="close-button"><X size={17} /></Dialog.Close></div>
                  <div className="notice-list">
                    <article><span className="notice-icon attention-icon"><Clock3 size={16} /></span><div><strong>Cotización lista para aprobar</strong><p>Plomería Rivera envió una cotización por $2,850.</p><small>Hace 12 min</small></div></article>
                    <article><span className="notice-icon"><CheckCircle2 size={16} /></span><div><strong>Pago SPEI cotejado</strong><p>El comprobante coincide con la renta de agosto.</p><small>Hace 2 h</small></div></article>
                  </div>
                  <button className="wide-quiet">{t.markRead}</button>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root>
              <Dialog.Trigger asChild><button className="new-action"><Plus size={15} />{t.newAction}</button></Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="action-dialog">
                  <div className="tray-heading"><div><p className="eyebrow">Portero</p><Dialog.Title>{t.newAction}</Dialog.Title></div><Dialog.Close className="close-button"><X size={17} /></Dialog.Close></div>
                  <Dialog.Description>Inicia una tarea. Portero preparará cada acción y pedirá tu aprobación cuando corresponda.</Dialog.Description>
                  <div className="action-choices">
                    <button onClick={() => { setView("conversations"); }}><MessagesSquare size={19} /><span><strong>Enviar un mensaje</strong><small>A un inquilino, propietario o contratista</small></span><ChevronRight size={17} /></button>
                    <button onClick={() => setView("maintenance")}><Wrench size={19} /><span><strong>Abrir mantenimiento</strong><small>Registrar y clasificar una solicitud</small></span><ChevronRight size={17} /></button>
                    <button><CalendarDays size={19} /><span><strong>Programar una visita</strong><small>Coordinar horarios por WhatsApp</small></span><ChevronRight size={17} /></button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <div className="avatar">CM</div>
          </div>
        </header>

        {view === "ledger" && (
          <div className="content-grid">
            <section className="ledger-panel">
              <div className="section-heading">
                <div><p className="eyebrow">{t.activityEyebrow}</p><h2>{t.attention}</h2></div>
                <span className="live"><i /> {t.live}</span>
              </div>
              <Tabs.Root value={ledgerFilter} onValueChange={setLedgerFilter}>
                <Tabs.List className="filter-tabs" aria-label="Activity filters">
                  <Tabs.Trigger value="all">{t.all}<span>{ledgerItems.length}</span></Tabs.Trigger>
                  <Tabs.Trigger value="approval">{t.approval}<span>{ledgerItems.filter((item) => item.type === "approval" && !decisions[item.id]).length}</span></Tabs.Trigger>
                  <Tabs.Trigger value="completed">{t.completed}</Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>
              <div className="ledger-list">
                {filteredLedger.map((item, index) => {
                  const decision = decisions[item.id];
                  return (
                    <article className={`ledger-card ${item.type === "approval" && !decision ? "attention" : ""} ${decision || ""}`} style={{ "--stagger": `${index * 40}ms` } as CSSProperties} key={item.id}>
                      <div className="ledger-rail"><span>{item.time}</span><i /></div>
                      <AvatarStack avatars={item.avatars} />
                      <div className="ledger-copy">
                        <div className="ledger-meta"><span>{item.id}</span><ChannelBadge /></div>
                        <h3>{decision === "approved" || item.type === "completed" ? item.resolvedTitle : item.title}</h3>
                        <p>{item.detail}</p>
                        <blockquote>{item.preview}</blockquote>
                        {item.action && !decision && (
                          <div className="card-actions">
                            <button className="approve" onClick={() => decide(item.id, "approved")}><Check size={14} />{t.approve}</button>
                            <button className="quiet"><Pencil size={13} />{t.edit}</button>
                            <button className="quiet danger" onClick={() => decide(item.id, "rejected")}><X size={13} />{t.reject}</button>
                          </div>
                        )}
                        {decision && <div className={`resolved-note ${decision}`}><span>{decision === "approved" ? <Check size={13} /> : <X size={13} />}</span>{decision === "approved" ? t.approved : t.rejected} · ahora</div>}
                        {!item.action && <div className="completed-note"><CheckCircle2 size={13} /> Completado automáticamente según tu política</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className="right-rail">
              <section className="agent-card">
                <div className="agent-card-top"><AgentOrb large /><span className="status-dot"><i /> Activo</span></div>
                <h2>{t.working}</h2>
                <p>{t.workingBody}</p>
                <div className="agent-stats"><div><strong>12</strong><span>{t.conversations}</span></div><div><strong>3</strong><span>{t.pending}</span></div></div>
              </section>
              <form className={`command-card ${commandSent ? "sent" : ""}`} onSubmit={submitCommand}>
                <div className="command-title"><Sparkles size={15} /><strong>{commandSent ? "Portero ya está en ello" : t.ask}</strong></div>
                {commandSent ? <p>Preparará la acción y la verás aparecer en este ledger.</p> : <><textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t.askPlaceholder} /><div className="command-footer"><span><Zap size={12} /> Se requiere aprobación</span><button aria-label="Send command"><ArrowUpRight size={15} /></button></div></>}
              </form>
              <section className="upcoming-card">
                <div className="rail-heading"><div><p className="eyebrow">{t.overview}</p><h3>{t.recent}</h3></div><button><MoreHorizontal size={17} /></button></div>
                <div className="upcoming-item"><span className="date-tile"><b>19</b><small>AGO</small></span><div><strong>3 visitas programadas</strong><small>Primera a las 10:30 · Del Valle</small></div></div>
                <div className="upcoming-item"><span className="icon-tile"><CircleDollarSign size={16} /></span><div><strong>7 rentas por confirmar</strong><small>$121,900 en transferencias</small></div></div>
                <button className="text-link" onClick={() => setView("conversations")}>{t.openInbox}<ChevronRight size={14} /></button>
              </section>
            </aside>
          </div>
        )}

        {view === "conversations" && (
          <section className="page-surface conversations-page">
            <div className="page-heading"><div><p className="eyebrow">WhatsApp · 8 abiertas</p><h2>{t.conversationsTitle}</h2><p>{t.inboxSubtitle}</p></div><button className="pill-button"><Plus size={15} /> Nueva conversación</button></div>
            <div className="inbox-layout">
              <aside className="conversation-list">
                <label className="search-field"><Search size={15} /><input aria-label={t.search} placeholder={`${t.search}…`} /></label>
                <div className="inbox-filters"><button className="selected">Todas <span>8</span></button><button>No leídas <span>3</span></button></div>
                {conversations.map((conversation) => <button className={`conversation-row ${selectedConversation === conversation.id ? "selected" : ""}`} onClick={() => setSelectedConversation(conversation.id)} key={conversation.id}><span className="person-orb">{conversation.initials}</span><span className="conversation-copy"><span><strong>{conversation.name}</strong><time>{conversation.time}</time></span><small>{conversation.unit}</small><p>{conversation.message}</p></span>{conversation.unread ? <em>{conversation.unread}</em> : null}</button>)}
              </aside>
              <section className="thread-panel">
                <header className="thread-header"><div><span className="person-orb">MG</span><span><strong>Mariana García</strong><small>Mérida 38 · 4B · Inquilina</small></span></div><div className="thread-actions"><button aria-label="Call"><Phone size={16} /></button><button aria-label="More options"><MoreHorizontal size={17} /></button></div></header>
                <div className="contact-context"><span><MessageCircle size={13} /> Español (México)</span><span><Users size={13} /> Formal · usted</span><span><FileCheck2 size={13} /> Contrato vinculado</span></div>
                <div className="thread-messages">
                  <p className="day-divider"><span>Hoy</span></p>
                  <div className="message inbound"><p>Hola, buenas tardes. ¿El contrato permite tener un gato en el departamento?</p><time>14:40</time></div>
                  <div className="agent-thinking"><AgentOrb /><span><Sparkles size={13} /> Portero encontró la cláusula 8.2 del contrato</span></div>
                  <div className="message draft"><span className="draft-label">Borrador · requiere aprobación</span><p>Buenas tardes, Mariana. Sí, su contrato permite una mascota doméstica con aviso previo a la administración. ¿Desea que registre a su gato?</p><div><button><Pencil size={13} /> Editar</button><button className="send-draft"><Check size={13} /> Aprobar y enviar</button></div></div>
                  {sentMessages.map((message, index) => <div className="message outbound" key={`${message}-${index}`}><p>{message}</p><time>Ahora · Enviado por ti</time></div>)}
                </div>
                <form className="composer" onSubmit={submitMessage}><button type="button" aria-label="Attach"><Paperclip size={17} /></button><input value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="Escribir como Casa Mérida…" /><button className="composer-send" aria-label={t.send}><Send size={15} /></button></form>
              </section>
              <aside className="contact-panel"><div className="contact-hero"><span className="person-orb large-person">MG</span><h3>Mariana García Muñoz</h3><p>Inquilina · desde febrero 2025</p></div><div className="contact-details"><p className="eyebrow">Contacto</p><span><Phone size={14} /> +52 55 2641 8402</span><span><Mail size={14} /> mariana@gmail.com</span><p className="eyebrow">Contrato activo</p><button className="lease-link"><FileText size={15} /><span><strong>Mérida 38 · 4B</strong><small>Vence 01/02/2027</small></span><ChevronRight size={14} /></button></div></aside>
            </div>
          </section>
        )}

        {view === "properties" && (
          <section className="page-flow">
            <div className="page-heading standalone"><div><p className="eyebrow">54 unidades · 96% ocupación</p><h2>{t.propertiesTitle}</h2><p>Tu portafolio, sus contratos y el estado operativo de cada unidad.</p></div><button className="pill-button"><Plus size={15} /> Agregar propiedad</button></div>
            <div className="metric-strip"><div><span className="metric-icon"><Home size={17} /></span><p>Unidades ocupadas<strong>52 <small>/ 54</small></strong></p></div><div><span className="metric-icon"><CircleDollarSign size={17} /></span><p>Renta mensual<strong>$1.13M</strong></p></div><div><span className="metric-icon"><ShieldCheck size={17} /></span><p>Contratos vigentes<strong>51</strong></p></div><div><span className="metric-icon"><Wrench size={17} /></span><p>Tickets abiertos<strong>3</strong></p></div></div>
            <div className="property-grid">{properties.map((property) => <article className="property-card" key={property.name}><header><span className="property-monogram">{property.name.charAt(0)}</span><button><MoreHorizontal size={17} /></button></header><h3>{property.name}</h3><p><MapPin size={13} />{property.area}</p><div className="property-stats"><span><small>Unidades</small><strong>{property.units}</strong></span><span><small>Ocupadas</small><strong>{property.occupied}</strong></span><span><small>Renta / mes</small><strong>{property.rent}</strong></span></div><footer><span className="state-chip">{property.tag}</span><button>Ver propiedad <ArrowUpRight size={13} /></button></footer></article>)}</div>
            <section className="table-card"><div className="table-heading"><div><h3>Unidades que requieren atención</h3><p>Vacantes, próximos vencimientos y saldos abiertos.</p></div><button><SlidersHorizontal size={15} /> Filtrar</button></div><div className="data-table"><div className="table-row header-row"><span>Unidad</span><span>Inquilino</span><span>Estado</span><span>Renta</span><span>Próximo paso</span></div><div className="table-row"><span><b>Amores 1120 · 4C</b><small>Del Valle</small></span><span>—</span><span><em className="state-chip attention-chip">Vacante</em></span><span className="mono">$24,500</span><span><button className="table-link">Publicar visita <ChevronRight size={13} /></button></span></div><div className="table-row"><span><b>Mérida 38 · 1A</b><small>Roma Norte</small></span><span>Sergio Núñez</span><span><em className="state-chip">Vence pronto</em></span><span className="mono">$19,800</span><span><button className="table-link">Preparar renovación <ChevronRight size={13} /></button></span></div></div></section>
          </section>
        )}

        {view === "maintenance" && (
          <section className="page-flow">
            <div className="page-heading standalone"><div><p className="eyebrow">3 abiertos · 1 requiere aprobación</p><h2>{t.maintenanceTitle}</h2><p>De la foto del inquilino al contratista, con cada decisión registrada.</p></div><button className="pill-button"><Plus size={15} /> Abrir ticket</button></div>
            <div className="maintenance-layout"><div className="ticket-list"><div className="section-toolbar"><div><button className="selected">Abiertos <span>3</span></button><button>Programados <span>5</span></button><button>Resueltos</button></div><button><SlidersHorizontal size={15} /> Filtros</button></div>{tickets.map((ticket) => <article className="ticket-card" key={ticket.ref}><div className="ticket-icon"><Wrench size={18} /></div><div className="ticket-main"><div className="ticket-meta"><span className="mono">{ticket.ref}</span><span className={`state-chip ${ticket.state === "Por aprobar" ? "attention-chip" : ""}`}>{ticket.state}</span></div><h3>{ticket.title}</h3><p>{ticket.place} · reportó {ticket.tenant}</p><div className="ticket-foot"><span><AlertTriangle size={13} /> Prioridad {ticket.severity.toLowerCase()}</span><span><Clock3 size={13} /> SLA {ticket.sla}</span></div></div><button className="round-arrow"><ChevronRight size={17} /></button></article>)}</div><aside className="sla-card"><p className="eyebrow">Cumplimiento · 30 días</p><h3>94% dentro del SLA</h3><div className="progress-ring"><span>94<small>%</small></span></div><div className="sla-stats"><span><b>18</b><small>resueltos</small></span><span><b>1.4 h</b><small>1ª respuesta</small></span></div><p>Portero detectó dos patrones de plomería en Durango 214.</p><button className="text-link">Ver informe <ArrowUpRight size={13} /></button></aside></div>
          </section>
        )}

        {view === "contracts" && (
          <section className="page-flow">
            <div className="page-heading standalone"><div><p className="eyebrow">128 archivos · todos indexados</p><h2>{t.contractsTitle}</h2><p>La fuente que Portero consulta antes de responder o proponer una acción.</p></div><button className="pill-button"><Upload size={15} /> {t.upload}</button></div>
            <div className="document-summary"><div><span className="metric-icon"><FileText size={17} /></span><p>Documentos<strong>128</strong></p></div><div><span className="metric-icon"><FileCheck2 size={17} /></span><p>Cláusulas extraídas<strong>1,842</strong></p></div><div><span className="metric-icon"><ShieldCheck size={17} /></span><p>Consentimiento vigente<strong>100%</strong></p></div></div>
            <section className="files-card"><div className="table-heading"><div><h3>Documentos recientes</h3><p>Contratos, identidad, garantías y comprobantes.</p></div><label className="search-field compact"><Search size={15} /><input placeholder="Buscar documentos…" /></label></div><div className="file-list">{files.map((file) => <button className="file-row" key={file.name}><span className="file-icon"><FileText size={18} /></span><span className="file-copy"><strong>{file.name}</strong><small>{file.meta}</small></span><span className="file-type">{file.type}</span><span className="indexed"><i />{file.status}</span><MoreHorizontal size={17} /></button>)}</div><footer className="files-footer"><span><i /> Todos los archivos están indexados</span><button>Ver los 128 archivos <ChevronRight size={14} /></button></footer></section>
          </section>
        )}

        {view === "settings" && (
          <section className="page-flow narrow-flow">
            <div className="page-heading standalone"><div><p className="eyebrow">Casa Mérida</p><h2>{t.settingsTitle}</h2><p>Controla cómo Portero conversa, decide y pide aprobación.</p></div><button className="pill-button">Guardar cambios</button></div>
            <section className="settings-card"><div className="settings-heading"><span className="settings-icon"><MessageCircle size={18} /></span><div><h3>Idioma y registro</h3><p>La interfaz, el idioma de cada contacto y su registro se configuran por separado.</p></div></div><div className="settings-grid"><label><span>Idioma de la interfaz</span><button>{t.localeName}<ChevronDown size={14} /></button></label><label><span>Registro predeterminado · inquilinos</span><button>Neutral<ChevronDown size={14} /></button></label><label><span>Registro predeterminado · propietarios</span><button>Formal · usted<ChevronDown size={14} /></button></label></div><div className="language-proof"><p className="eyebrow">Prueba de caracteres</p><p>¿Cuándo podría ver el departamento? — Señor Muñoz, N.L.</p></div></section>
            <section className="settings-card"><div className="settings-heading"><span className="settings-icon"><ShieldCheck size={18} /></span><div><h3>Políticas de aprobación</h3><p>Las organizaciones nuevas comienzan con Portero pidiendo aprobación con frecuencia.</p></div></div><div className="policy-list"><div><span><strong>Responder desde contratos vinculados</strong><small>Preguntas sobre cláusulas y datos de la unidad</small></span><em className="state-chip">Automático</em></div><div><span><strong>Programar visitas y servicios</strong><small>Cualquier acción que modifique un calendario</small></span><em className="state-chip attention-chip">Aprobar</em></div><div><span><strong>Cotizaciones mayores a $3,000 MXN</strong><small>Aprendido de 4 decisiones anteriores</small></span><em className="state-chip attention-chip">Aprobar</em></div><div><span><strong>Riesgo legal o habitabilidad</strong><small>Desalojo, discriminación, gas, agua o estructura</small></span><em className="state-chip critical-chip">Escalar</em></div></div></section>
          </section>
        )}
      </section>
    </main>
  );
}
