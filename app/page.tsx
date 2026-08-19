"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Archive, Bell, Calendar, ChatLines, Check, CheckCircle, Clock, CoinsSwap,
  Dashboard, Database, FilterList, HomeSimpleDoor, Key, NetworkLeft,
  NavArrowDown, NavArrowRight, Page, Pause, Phone, Plus, Search, Settings,
  ShieldCheck, StatsUpSquare, TaskList, Tools, User, ViewColumns3, ViewGrid, Xmark,
} from "iconoir-react";
import { siApple, siGmail, siNotion, siQuickbooks, siTelegram, siWhatsapp, siXero } from "simple-icons";

type View = "overview" | "tasks" | "inbox" | "properties" | "leasing" | "maintenance" | "accounting" | "connections" | "documents" | "settings";
type Provider = {
  id: string; title: string; category: string; description: string; authMode: string;
  permissions: string[]; credentialFields?: { key: string; label: string; secret?: boolean }[];
  env: string[]; webhook: boolean; readOnly: boolean; note: string; configured?: boolean;
  connection?: { status: string; externalAccountName?: string | null; lastSyncAt?: string | null } | null;
};
type IconComponent = ComponentType<{ width?: number; height?: number; className?: string }>;

const navGroups: { label: string; items: { id: View; label: string; icon: IconComponent; count?: number }[] }[] = [
  { label: "Agent", items: [
    { id: "overview", label: "Portfolio overview", icon: Dashboard },
    { id: "tasks", label: "Portero tasks", icon: TaskList, count: 4 },
    { id: "inbox", label: "Shared inbox", icon: ChatLines, count: 7 },
  ]},
  { label: "Operations", items: [
    { id: "properties", label: "Properties", icon: HomeSimpleDoor },
    { id: "leasing", label: "Leasing", icon: User },
    { id: "maintenance", label: "Maintenance", icon: Tools },
    { id: "accounting", label: "Accounting", icon: CoinsSwap },
  ]},
  { label: "Workspace", items: [
    { id: "connections", label: "Connections", icon: NetworkLeft },
    { id: "documents", label: "Documents", icon: Page },
    { id: "settings", label: "Settings", icon: Settings },
  ]},
];

const fallbackProviders: Provider[] = [
  { id: "quickbooks", title: "QuickBooks Online", category: "Accounting", description: "Receivables, payments, invoices, and operating reports.", authMode: "oauth2", permissions: ["Accounting data"], env: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"], webhook: true, readOnly: true, note: "Read-only API calls after OAuth.", configured: false },
  { id: "xero", title: "Xero", category: "Accounting", description: "Invoices, bank transactions, payments, contacts, and reports.", authMode: "oauth2", permissions: ["Granular accounting read scopes"], env: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Uses granular read scopes.", configured: false },
  { id: "appfolio", title: "AppFolio", category: "Leasing & PMS", description: "Inquiries, showings, applications, leases, tenants, and ledgers.", authMode: "credentials", permissions: ["Rental applications", "Showings", "Tenant ledgers"], credentialFields: [{ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret", secret: true }, { key: "database", label: "Database name" }], env: [], webhook: false, readOnly: true, note: "Requires the customer's enabled AppFolio Stack API products.", configured: true },
  { id: "buildium", title: "Buildium", category: "Leasing & PMS", description: "Rentals, applicants, leases, tasks, and accounting data.", authMode: "credentials", permissions: ["Rentals", "Applicants", "Leases"], credentialFields: [{ key: "clientId", label: "Buildium client ID" }, { key: "clientSecret", label: "Buildium client secret", secret: true }], env: [], webhook: false, readOnly: true, note: "Server-to-server client headers.", configured: true },
  { id: "whatsapp", title: "WhatsApp Business", category: "Communication", description: "Tenant messaging through Meta's Cloud API.", authMode: "credentials", permissions: ["Messages", "Business account"], credentialFields: [{ key: "phoneNumberId", label: "Phone number ID" }, { key: "accessToken", label: "Permanent access token", secret: true }], env: ["META_WHATSAPP_APP_SECRET", "META_WHATSAPP_VERIFY_TOKEN"], webhook: true, readOnly: false, note: "Signed webhook verification is required.", configured: false },
  { id: "apple_messages", title: "Apple Messages", category: "Communication", description: "Apple Messages for Business via an approved messaging provider.", authMode: "msp", permissions: ["Business registration", "MSP routing"], credentialFields: [{ key: "provider", label: "Messaging Service Provider" }, { key: "webhookSecret", label: "Webhook signing secret", secret: true }], env: [], webhook: true, readOnly: false, note: "Apple does not expose direct iMessage OAuth.", configured: true },
  { id: "slack", title: "Slack", category: "Communication", description: "Selected channels, approvals, and task updates.", authMode: "oauth2", permissions: ["Channel history", "Post messages", "Users"], env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"], webhook: true, readOnly: false, note: "Workspace admins choose channels during OAuth.", configured: false },
  { id: "notion", title: "Notion", category: "Knowledge", description: "Only pages and databases explicitly shared with Portero.", authMode: "oauth2", permissions: ["Selected pages and databases"], env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"], webhook: false, readOnly: true, note: "The authorization screen controls page access.", configured: false },
  { id: "outlook", title: "Outlook", category: "Communication", description: "Selected mail and calendar context through Microsoft Graph.", authMode: "oauth2", permissions: ["Mail.Read", "Calendars.Read"], env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Delegated access only.", configured: false },
  { id: "gmail", title: "Gmail", category: "Communication", description: "Read-only property operations email and threads.", authMode: "oauth2", permissions: ["gmail.readonly"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Narrow read-only Google scope.", configured: false },
  { id: "telegram", title: "Telegram", category: "Communication", description: "A tenant and contractor bot with verified webhook updates.", authMode: "bot_token", permissions: ["Bot messages", "Updates"], credentialFields: [{ key: "botToken", label: "Bot token", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true }], env: [], webhook: true, readOnly: false, note: "Telegram secret-token validation is built in.", configured: true },
  { id: "twilio", title: "Calls & SMS", category: "Communication", description: "Calls, SMS, recordings, and resident timeline context.", authMode: "credentials", permissions: ["Calls", "Messages", "Recordings"], credentialFields: [{ key: "accountSid", label: "Account SID" }, { key: "authToken", label: "Auth token", secret: true }], env: [], webhook: true, readOnly: false, note: "Twilio-compatible telephony.", configured: true },
  { id: "granola", title: "Granola", category: "Knowledge", description: "Meeting notes, transcripts, participants, and follow-ups.", authMode: "api_key", permissions: ["Meeting notes", "Transcripts"], credentialFields: [{ key: "apiKey", label: "Granola API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Granola public API access.", configured: true },
];
const providerOrder = ["whatsapp", "apple_messages", "slack", "notion", "outlook", "gmail", "telegram", "twilio", "granola"];

function SimpleMark({ icon }: { icon: { path: string; hex: string; title: string } }) {
  return <svg viewBox="0 0 24 24" aria-label={icon.title} role="img"><path fill={`#${icon.hex}`} d={icon.path}/></svg>;
}
function SlackMark() {
  return <svg viewBox="0 0 24 24" aria-label="Slack" role="img">
    <rect x="9.6" width="4.8" height="10.4" rx="2.4" fill="#36C5F0"/><rect y="9.6" width="10.4" height="4.8" rx="2.4" fill="#36C5F0"/>
    <rect x="13.6" y="9.6" width="10.4" height="4.8" rx="2.4" fill="#2EB67D"/><rect x="9.6" y="13.6" width="4.8" height="10.4" rx="2.4" fill="#2EB67D"/>
    <rect x="9.6" y="13.6" width="4.8" height="10.4" rx="2.4" fill="#ECB22E" transform="rotate(90 12 18.8)"/><rect x="9.6" y="13.6" width="4.8" height="10.4" rx="2.4" fill="#ECB22E"/>
    <rect y="9.6" width="10.4" height="4.8" rx="2.4" fill="#E01E5A" transform="rotate(90 5.2 12)"/><rect y="9.6" width="10.4" height="4.8" rx="2.4" fill="#E01E5A"/>
  </svg>;
}
function OutlookMark() {
  return <svg viewBox="0 0 24 24" aria-label="Microsoft Outlook" role="img"><path fill="#0A64C9" d="M1 4.8 11.1 3v18L1 19.2z"/><path fill="#1976D2" d="M12.3 5h10.3v14H12.3z"/><path fill="#fff" d="M12.3 8.3h10.3v1.2l-5.1 3.9-5.2-3.9z"/><path fill="#fff" d="M4 8h4.2c2.3 0 3.6 1.6 3.6 4s-1.3 4-3.7 4H4zm2.2 1.8v4.4h1.7c1.1 0 1.7-.8 1.7-2.2s-.6-2.2-1.7-2.2z"/></svg>;
}
function TwilioMark() {
  return <svg viewBox="0 0 24 24" aria-label="Twilio" role="img"><circle cx="12" cy="12" r="10" fill="#F22F46"/><g fill="#fff"><circle cx="8.6" cy="8.6" r="2.1"/><circle cx="15.4" cy="8.6" r="2.1"/><circle cx="8.6" cy="15.4" r="2.1"/><circle cx="15.4" cy="15.4" r="2.1"/></g></svg>;
}
function BrandMark({ provider, small = false }: { provider: string; small?: boolean }) {
  const inner = provider === "whatsapp" ? <SimpleMark icon={siWhatsapp}/> : provider === "apple_messages" ? <SimpleMark icon={siApple}/> : provider === "slack" ? <SlackMark/> : provider === "notion" ? <SimpleMark icon={siNotion}/> : provider === "outlook" ? <OutlookMark/> : provider === "gmail" ? <SimpleMark icon={siGmail}/> : provider === "telegram" ? <SimpleMark icon={siTelegram}/> : provider === "twilio" ? <TwilioMark/> : provider === "quickbooks" ? <SimpleMark icon={siQuickbooks}/> : provider === "xero" ? <SimpleMark icon={siXero}/> : provider === "appfolio" ? <span className="wordmark appfolio-mark">a</span> : provider === "buildium" ? <span className="wordmark buildium-mark">B</span> : provider === "granola" ? <span className="wordmark granola-mark">g</span> : <Database width={22} height={22}/>;
  return <span className={`brand-mark ${small ? "small" : ""} brand-${provider}`}>{inner}</span>;
}

function AppHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <header className="app-header"><div><p className="eyebrow">Portero workspace</p><h1>{title}</h1>{subtitle && <p className="header-subtitle">{subtitle}</p>}</div><div className="header-actions">{actions}<button className="icon-button" aria-label="Notifications"><Bell width={20} height={20}/><span className="notification-dot"/></button></div></header>;
}

const metrics = [
  { label: "Net operating income", value: "$286,410", delta: "+4.8%", detail: "month to date", bars: [28, 38, 34, 51, 49, 62, 68] },
  { label: "Economic occupancy", value: "94.2%", delta: "+1.2%", detail: "vs prior month", bars: [51, 48, 55, 57, 62, 67, 72] },
  { label: "Rent collected", value: "$612,800", delta: "92.6%", detail: "of August billing", bars: [18, 31, 42, 49, 61, 72, 78] },
  { label: "Open work orders", value: "18", delta: "4 urgent", detail: "2.7 days avg close", bars: [72, 64, 60, 47, 43, 36, 31] },
];
const stages = [
  { label: "Leads contacted", value: 148, width: "100%" }, { label: "Viewed", value: 82, width: "78%" },
  { label: "Applied", value: 37, width: "56%" }, { label: "Signed", value: 21, width: "40%" },
];

function Overview({ openConnections }: { openConnections: () => void }) {
  return <div className="view-wrap">
    <AppHeader title="Portfolio overview" subtitle="A calm, live read on leasing, cash, and service." actions={<><button className="soft-button"><Calendar width={18} height={18}/> Aug 12–18 <NavArrowDown width={16} height={16}/></button><button className="primary-button" onClick={openConnections}><NetworkLeft width={18} height={18}/> Connect data</button></>}/>
    <section className="overview-intro"><div><span className="presence-dot"/> Updated 4 minutes ago</div><p>142 units across 6 properties</p></section>
    <section className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><StatsUpSquare width={18} height={18}/></div><strong>{metric.value}</strong><div className="metric-meta"><span>{metric.delta}</span> {metric.detail}</div><div className="mini-bars" aria-hidden="true">{metric.bars.map((height, index) => <i key={index} style={{ height: `${height}%` }}/>)}</div></article>)}</section>
    <section className="overview-grid">
      <article className="panel funnel-panel"><div className="panel-heading"><div><p className="eyebrow">Leasing</p><h2>Lead-to-lease funnel</h2></div><span className="quiet-label">Last 7 days</span></div><div className="funnel-stage-labels">{stages.map((stage) => <div key={stage.label}><strong>{stage.value}</strong><span>{stage.label}</span></div>)}</div><div className="funnel-graphic">{stages.map((stage) => <div className="funnel-band" style={{ width: stage.width }} key={stage.label}/>)}</div><div className="funnel-footer"><span><strong>55.4%</strong> contacted → viewed</span><span><strong>14.2%</strong> contacted → signed</span><button className="text-button" onClick={openConnections}>Configure source <NavArrowRight width={16} height={16}/></button></div></article>
      <article className="panel coverage-panel"><div className="panel-heading"><div><p className="eyebrow">Data coverage</p><h2>Two sources unlock the view</h2></div><ShieldCheck width={22} height={22}/></div><div className="source-row"><BrandMark provider="quickbooks" small/><div><strong>Accounting</strong><span>QuickBooks or Xero</span></div><span className="status-pill">Required</span></div><div className="source-row"><BrandMark provider="appfolio" small/><div><strong>Leasing pipeline</strong><span>AppFolio, Buildium, or PMS</span></div><span className="status-pill">Required</span></div><div className="source-row"><BrandMark provider="whatsapp" small/><div><strong>Resident channels</strong><span>Messages, email, and calls</span></div><span className="status-pill optional">Optional</span></div><button className="wide-button" onClick={openConnections}>Open connections <NavArrowRight width={17} height={17}/></button></article>
    </section>
    <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Portero, now</p><h2>Work moving through the system</h2></div><button className="soft-button"><Archive width={17} height={17}/> History</button></div><div className="activity-flow"><div className="activity-card tall"><div><BrandMark provider="whatsapp" small/><span className="activity-time">21:04</span></div><p>Nightly delinquency sweep found 4 accounts past due.</p></div><span className="flow-arrow">→</span><div className="activity-card"><div><BrandMark provider="slack" small/></div><p>Flags the accounts to the portfolio manager.</p></div><span className="flow-arrow">→</span><div className="activity-card"><div><BrandMark provider="twilio" small/></div><p>Calls the resident after approval.</p></div><span className="flow-arrow">→</span><div className="activity-card complete"><div><CheckCircle width={24} height={24}/></div><p>Payment plan set up; secure link sent.</p></div></div></section>
  </div>;
}

const tasks = [
  { id: 1, status: "needs", title: "Approve payment-plan response", detail: "Diana Ortiz · 12 days past due", provider: "whatsapp", time: "9 min", action: "Review draft" },
  { id: 2, status: "progress", title: "Book a viewing for tomorrow at 3pm", detail: "Marcus Lee · Franklin House 4B", provider: "apple_messages", time: "18 min", action: "In progress" },
  { id: 3, status: "progress", title: "Reconcile three unmatched deposits", detail: "August operating account", provider: "quickbooks", time: "26 min", action: "In progress" },
  { id: 4, status: "parked", title: "Wait for vendor estimate", detail: "Boiler repair · Union Court", provider: "outlook", time: "1 hr", action: "Waiting" },
  { id: 5, status: "done", title: "Lease signed and filed", detail: "AppFolio · Franklin House 4B", provider: "appfolio", time: "Today", action: "Complete" },
  { id: 6, status: "done", title: "Viewing added to calendar", detail: "Marcus Lee · tomorrow 3:00pm", provider: "outlook", time: "Today", action: "Complete" },
];
const columns = [
  { id: "needs", label: "Needs you", icon: User }, { id: "progress", label: "In progress", icon: Clock },
  { id: "parked", label: "Parked", icon: Pause }, { id: "done", label: "Done", icon: CheckCircle },
];

function TasksView() {
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const visible = tasks.filter((task) => `${task.title} ${task.detail}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="view-wrap task-view"><AppHeader title="Tasks" subtitle="Everything Portero is doing, waiting on, or has finished." actions={<><div className="segmented compact"><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} aria-label="List"><ViewColumns3 width={18} height={18}/></button><button className={layout === "board" ? "active" : ""} onClick={() => setLayout("board")} aria-label="Board"><ViewGrid width={18} height={18}/></button></div><button className="primary-button"><Plus width={18} height={18}/> New task</button></>}/><div className="task-toolbar"><label className="search-field"><Search width={19} height={19}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks"/></label><button className="soft-button"><Calendar width={17} height={17}/> Last 7 days <NavArrowDown width={15} height={15}/></button><button className="soft-button"><FilterList width={17} height={17}/> Filters</button></div><div className={`task-board ${layout}`}>{columns.map((column) => { const Icon = column.icon; const columnTasks = visible.filter((task) => task.status === column.id); return <section className="task-column" key={column.id}><div className="column-heading"><span><Icon width={20} height={20}/>{column.label}</span><b>{columnTasks.length}</b></div><div className="column-list">{columnTasks.length ? columnTasks.map((task) => <article className="task-card" key={task.id}><div className="task-card-top"><BrandMark provider={task.provider} small/><span>{task.time}</span></div><h3>{task.title}</h3><p>{task.detail}</p><div className="task-card-bottom"><span>{task.action}</span><button aria-label="Open task"><NavArrowRight width={17} height={17}/></button></div></article>) : <div className="empty-column">Nothing here</div>}</div></section>; })}</div></div>;
}

const inboxItems = [
  { name: "Marcus Lee", unit: "Franklin House · 4B", text: "Tomorrow at three works perfectly.", provider: "apple_messages", time: "2m", unread: 2 },
  { name: "Diana Ortiz", unit: "Monroe Court · 2A", text: "Could we split this month's balance?", provider: "whatsapp", time: "11m", unread: 1 },
  { name: "Alvarez Plumbing", unit: "Vendor · Maintenance", text: "Estimate attached for the boiler.", provider: "outlook", time: "24m", unread: 0 },
  { name: "Portfolio team", unit: "Slack · #operations", text: "Approved. Go ahead and send it.", provider: "slack", time: "41m", unread: 0 },
];
function InboxView() {
  const [active, setActive] = useState(0); const current = inboxItems[active];
  return <div className="view-wrap"><AppHeader title="Shared inbox" subtitle="One resident timeline across every connected channel." actions={<button className="primary-button"><Plus width={18} height={18}/> New message</button>}/><div className="inbox-window"><aside className="conversation-list"><label className="search-field"><Search width={18} height={18}/><input placeholder="Search conversations"/></label>{inboxItems.map((item, index) => <button className={`conversation-row ${active === index ? "active" : ""}`} onClick={() => setActive(index)} key={item.name}><BrandMark provider={item.provider} small/><span><strong>{item.name}</strong><small>{item.unit}</small><em>{item.text}</em></span><i>{item.time}</i>{item.unread > 0 && <b>{item.unread}</b>}</button>)}</aside><section className="message-thread"><header><div><BrandMark provider={current.provider} small/><div><strong>{current.name}</strong><span>{current.unit}</span></div></div><button className="icon-button"><Phone width={20} height={20}/></button></header><div className="message-canvas"><div className="date-divider">Today</div><div className="message received"><p>Hi, I had a question about the next step.</p><span>14:18</span></div><div className="message sent"><p>Of course. I can help with that. The viewing is held for tomorrow at 3pm.</p><span>14:19 · Portero draft approved</span></div><div className="message received"><p>{current.text}</p><span>14:21</span></div></div><footer className="composer"><button className="icon-button"><Plus width={19} height={19}/></button><input placeholder="Write a reply or ask Portero…"/><button className="primary-button">Send</button></footer></section><aside className="contact-panel"><p className="eyebrow">Resident context</p><div className="profile-block"><span className="initials">{current.name.split(" ").map((part) => part[0]).join("")}</span><h3>{current.name}</h3><p>{current.unit}</p></div><dl><div><dt>Stage</dt><dd>Viewing booked</dd></div><div><dt>Source</dt><dd>{current.provider.replace("_", " ")}</dd></div><div><dt>Owner</dt><dd>Leasing team</dd></div></dl><button className="wide-button">Open resident record <NavArrowRight width={17} height={17}/></button></aside></div></div>;
}

function SourceCard({ provider, title, detail, onOpen }: { provider: string; title: string; detail: string; onOpen: (provider: string) => void }) {
  return <article className="required-source"><BrandMark provider={provider}/><div><p className="eyebrow">Required upstream system</p><h3>{title}</h3><p>{detail}</p><div className="scope-row"><span><ShieldCheck width={15} height={15}/> Read access only</span><span><Database width={15} height={15}/> Historical sync</span></div></div><button className="primary-button" onClick={() => onOpen(provider)}>Connect <NavArrowRight width={17} height={17}/></button></article>;
}
function ConnectionsView({ providers, loading, onOpen }: { providers: Provider[]; loading: boolean; onOpen: (id: string) => void }) {
  const apps = providerOrder.map((id) => providers.find((provider) => provider.id === id)).filter(Boolean) as Provider[];
  return <div className="view-wrap connections-view"><AppHeader title="Connections" subtitle="A secure, explicit bridge between Portero and the systems where your work already lives." actions={<button className="soft-button"><ShieldCheck width={18} height={18}/> Security model</button>}/><section className="connection-hero"><div><p className="eyebrow">Connection layer</p><h2>Bring the operating system together.</h2><p>Authorize only the sources Portero needs. Every connection has its own scopes, verification, sync cursor, and revocation path.</p></div><div className="pipeline-diagram"><span><Key width={18} height={18}/> Authorize</span><i/><span><ShieldCheck width={18} height={18}/> Verify</span><i/><span><NetworkLeft width={18} height={18}/> Normalize</span><i/><span><Database width={18} height={18}/> Read models</span></div></section><section><div className="section-title"><div><p className="eyebrow">Foundation</p><h2>Connect two upstream systems</h2></div><p>Your portfolio metrics and leasing funnel stay locked until their source is verified.</p></div><div className="required-grid"><SourceCard provider="quickbooks" title="Accounting system" detail="Choose QuickBooks, Xero, or a supported PMS accounting module for receivables, payments, occupancy economics, and delinquency." onOpen={onOpen}/><SourceCard provider="appfolio" title="Leasing pipeline" detail="Choose AppFolio, Buildium, or your PMS source to map leads contacted → viewed → applied → signed." onOpen={onOpen}/></div></section><section><div className="section-title"><div><p className="eyebrow">Channels & context</p><h2>Meet Portero where the work happens</h2></div><p>{loading ? "Checking your workspace…" : "Brand permissions stay isolated per connection."}</p></div><div className="connection-grid">{apps.map((provider) => <article className="connection-card" key={provider.id}><div className="connection-card-top"><BrandMark provider={provider.id}/><span className={`connection-status ${provider.connection?.status ?? "not-connected"}`}>{provider.connection?.status?.replaceAll("_", " ") ?? (provider.configured ? "Ready to configure" : "Credentials required")}</span></div><h3>{provider.title}</h3><p>{provider.description}</p><div className="connection-features"><span>{provider.readOnly ? "Read only" : "Two-way"}</span><span>{provider.webhook ? "Webhook" : "Scheduled sync"}</span></div><button className="wide-button" onClick={() => onOpen(provider.id)}>{provider.connection?.status === "connected" ? "Manage" : "Set up"}<NavArrowRight width={17} height={17}/></button></article>)}</div></section></div>;
}

function OperationsView({ view, openConnections }: { view: View; openConnections: () => void }) {
  const copy: Record<string, { title: string; subtitle: string; metrics: { label: string; value: string }[] }> = {
    properties: { title: "Properties", subtitle: "The portfolio, with operational context attached.", metrics: [{ label: "Properties", value: "6" }, { label: "Units", value: "142" }, { label: "Occupied", value: "134" }, { label: "Ready for leasing", value: "5" }] },
    leasing: { title: "Leasing", subtitle: "Every prospect from first contact to signed lease.", metrics: [{ label: "Leads contacted", value: "148" }, { label: "Viewed", value: "82" }, { label: "Applied", value: "37" }, { label: "Signed", value: "21" }] },
    maintenance: { title: "Maintenance", subtitle: "Requests, vendor handoffs, and work completion in one line.", metrics: [{ label: "Reported", value: "31" }, { label: "Assigned", value: "24" }, { label: "Work done", value: "18" }, { label: "Completed", value: "16" }] },
    accounting: { title: "Accounting", subtitle: "A read-only operational view of rent, cash, and receivables.", metrics: [{ label: "Rent billed", value: "$662k" }, { label: "Collected", value: "$613k" }, { label: "Past due", value: "$49k" }, { label: "Collection rate", value: "92.6%" }] },
    documents: { title: "Documents", subtitle: "Files indexed against the people, properties, and tasks they belong to.", metrics: [{ label: "Files indexed", value: "284" }, { label: "Lease files", value: "138" }, { label: "Vendor files", value: "61" }, { label: "Needs review", value: "7" }] },
    settings: { title: "Settings", subtitle: "Workspace identity, permissions, and Portero's operating boundaries.", metrics: [{ label: "Members", value: "8" }, { label: "Approvers", value: "3" }, { label: "Automations", value: "12" }, { label: "Audit events", value: "1.8k" }] },
  };
  const data = copy[view];
  return <div className="view-wrap"><AppHeader title={data.title} subtitle={data.subtitle} actions={<button className="primary-button" onClick={openConnections}><NetworkLeft width={18} height={18}/> Connect source</button>}/><section className="metric-grid compact-metrics">{data.metrics.map((metric) => <article className="metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><div className="empty-spark"/></article>)}</section><section className="panel locked-panel"><div className="locked-visual"><div className="locking-lines"><i/><i/><i/></div><span><Key width={23} height={23}/></span></div><div><p className="eyebrow">Verified data required</p><h2>Connect the system that owns this workflow.</h2><p>Portero will preserve source IDs, sync cursors, and timestamps so every figure can be traced back to its upstream record.</p><button className="primary-button" onClick={openConnections}>Open connections <NavArrowRight width={17} height={17}/></button></div></section></div>;
}

function ConnectionDialog({ provider, onClose, onRefresh }: { provider: Provider | null; onClose: () => void; onRefresh: () => void }) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "working" | "error" | "saved">("idle");
  const [message, setMessage] = useState("");
  if (!provider) return null;
  const connect = async (event?: FormEvent) => {
    event?.preventDefault(); setStatus("working"); setMessage("");
    try {
      const response = await fetch("/api/integrations/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: provider.id, credentials: provider.authMode === "oauth2" ? undefined : credentials }) });
      const data = await response.json() as { authorizationUrl?: string; error?: string; required?: string[] };
      if (!response.ok) throw new Error(data.error ? `${data.error}${data.required ? `: ${data.required.join(", ")}` : ""}` : "Connection failed");
      if (data.authorizationUrl) { window.location.href = data.authorizationUrl; return; }
      setStatus("saved"); setMessage("Credentials encrypted. Verification is the next step."); onRefresh();
    } catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Connection failed"); }
  };
  return <Dialog.Root open onOpenChange={(open) => !open && onClose()}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="connection-dialog"><div className="dialog-top"><BrandMark provider={provider.id}/><Dialog.Close className="icon-button" aria-label="Close"><Xmark width={20} height={20}/></Dialog.Close></div><Dialog.Title>{provider.title}</Dialog.Title><Dialog.Description>{provider.description}</Dialog.Description><div className="dialog-status-row"><span><ShieldCheck width={16} height={16}/>{provider.readOnly ? "Read access" : "Two-way channel"}</span><span><Key width={16} height={16}/>{provider.authMode.replace("_", " ")}</span><span><NetworkLeft width={16} height={16}/>{provider.webhook ? "Webhook + sync" : "Scheduled sync"}</span></div><Tabs.Root defaultValue="access"><Tabs.List className="dialog-tabs"><Tabs.Trigger value="access">Access</Tabs.Trigger><Tabs.Trigger value="architecture">Architecture</Tabs.Trigger></Tabs.List><Tabs.Content value="access"><div className="permission-box"><p>Portero will request</p>{provider.permissions.map((permission) => <span key={permission}><Check width={16} height={16}/>{permission}</span>)}</div><p className="connection-note">{provider.note}</p></Tabs.Content><Tabs.Content value="architecture"><ol className="architecture-list"><li><b>01</b><span><strong>Authorize</strong>Credential or OAuth consent is scoped to this workspace.</span></li><li><b>02</b><span><strong>Verify</strong>Tokens are encrypted and incoming events are signature checked.</span></li><li><b>03</b><span><strong>Normalize</strong>Source IDs and timestamps are preserved in Portero&apos;s read models.</span></li></ol></Tabs.Content></Tabs.Root>{provider.authMode !== "oauth2" && <form className="credential-form" onSubmit={connect}>{provider.credentialFields?.map((field) => <label key={field.key}>{field.label}<input type={field.secret ? "password" : "text"} value={credentials[field.key] ?? ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} autoComplete="off" required/></label>)}</form>}{message && <p className={`dialog-message ${status}`}>{message}</p>}<div className="dialog-actions"><button className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={status === "working" || status === "saved"} onClick={() => connect()}>{status === "working" ? "Preparing…" : status === "saved" ? "Saved" : provider.authMode === "oauth2" ? "Continue to authorization" : "Encrypt & continue"}<NavArrowRight width={17} height={17}/></button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export default function Home() {
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "overview";
    const requested = new URLSearchParams(window.location.search).get("view") as View | null;
    return requested && navGroups.some((group) => group.items.some((item) => item.id === requested)) ? requested : "overview";
  });
  const [providers, setProviders] = useState<Provider[]>(fallbackProviders);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const loadProviders = async () => { try { const response = await fetch("/api/integrations"); const data = await response.json() as { providers?: Provider[] }; if (data.providers?.length) setProviders(data.providers); } catch { /* usable without D1 */ } setLoading(false); };
  useEffect(() => { queueMicrotask(() => void loadProviders()); }, []);
  const setActiveView = (next: View) => { setView(next); const url = new URL(window.location.href); url.searchParams.set("view", next); window.history.replaceState({}, "", url); };
  const openConnections = () => setActiveView("connections");
  const openProvider = (id: string) => setSelectedProvider(providers.find((provider) => provider.id === id) ?? null);
  const title = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === view)?.label ?? "Portero", [view]);
  return <main className="app-shell"><aside className="sidebar"><div className="brand-lockup"><span className="brand-symbol">p</span><div><strong>portero</strong><small>Property operations</small></div><button className="icon-button sidebar-collapse" aria-label="Collapse sidebar"><ViewColumns3 width={18} height={18}/></button></div><nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map((item) => { const Icon = item.icon; return <button className={view === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} key={item.id} title={item.label}><Icon width={20} height={20}/><span>{item.label}</span>{item.count && <b>{item.count}</b>}{view === item.id && <NavArrowRight className="nav-chevron" width={16} height={16}/>}</button>; })}</div>)}</nav><div className="workspace-card"><span className="initials">AC</span><div><strong>Acme Residential</strong><small>Camila Reyes</small></div><button className="icon-button"><NavArrowDown width={16} height={16}/></button></div></aside><section className="content-shell" aria-label={title}>{view === "overview" && <Overview openConnections={openConnections}/>} {view === "tasks" && <TasksView/>} {view === "inbox" && <InboxView/>} {view === "connections" && <ConnectionsView providers={providers} loading={loading} onOpen={openProvider}/>} {["properties", "leasing", "maintenance", "accounting", "documents", "settings"].includes(view) && <OperationsView view={view} openConnections={openConnections}/>}</section>{selectedProvider && <ConnectionDialog provider={selectedProvider} onClose={() => setSelectedProvider(null)} onRefresh={loadProviders}/>}</main>;
}
