"use client";
/* eslint-disable jsx-a11y/no-autofocus */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Archive, Attachment, Bell, Calendar, ChatLines, Check, CheckCircle, ClipboardCheck, Clock,
  Coins, CoinsSwap, Dashboard, Database, FilterList, Flash, Globe, HalfMoon, HomeSimpleDoor, Key,
  Language, LogOut, NetworkLeft, NavArrowDown, NavArrowLeft, NavArrowRight, Page, Pause,
  Phone, Plus, ScaleFrameEnlarge, ScaleFrameReduce, Search, SendDiagonal, Settings, ShieldCheck, SmartphoneDevice,
  SoundHigh, SoundOff, StatsUpSquare, SunLight, TaskList, Tools, User,
  ViewColumns3, ViewGrid, Xmark, XmarkCircle,
} from "iconoir-react";
import { siApple, siGmail, siNotion, siQuickbooks, siTelegram, siWhatsapp, siXero } from "simple-icons";
import { AnimatedNumber, ExperienceProvider, useExperience } from "@/app/components/experience";
import { Link, useRouter, usePathname } from "./navigation";
import { AvalAssistant } from "@/app/components/aval-assistant";
import type { AuthMode } from "@/app/components/auth-gate";
import { AskAvalTasksSection, useDraftJobs, type CreateDraftInput, type DraftJob } from "@/app/components/ask-aval-tasks";
import { BillingSettings } from "@/app/components/billing-settings";
import { derivedSample, derivePropertyTotals, deriveMaintenanceReported, rankInsights, sampleData, type InsightCandidate, type InsightRecipient, type NotificationItem, type NotificationTarget, type ReviewStatus } from "@/app/data/sample";
import { AccountingSankey, LeasingTrendChart, MaintenanceRoseChart, PropertyOccupancyChart } from "@/app/components/charts";

type View = "overview" | "tasks" | "reviewCenter" | "inbox" | "properties" | "leasing" | "maintenance" | "accounting" | "connections" | "documents" | "settings";
type DataMode = "sample" | "empty" | "live";
type Provider = {
  id: string; title: string; category: string; description: string; authMode: string;
  permissions: string[]; credentialFields?: { key: string; label: string; secret?: boolean }[];
  env: string[]; webhook: boolean; readOnly: boolean; note: string; configured?: boolean;
  connection?: { id?: string; status: string; externalAccountName?: string | null; lastSyncAt?: string | null } | null;
};
type IconComponent = ComponentType<{ width?: number; height?: number; className?: string }>;
type T = ReturnType<typeof useTranslations>;

const navGroups: { labelKey: string; items: { id: View; labelKey: string; icon: IconComponent; count?: number }[] }[] = [
  { labelKey: "Nav.agent", items: [
    { id: "overview", labelKey: "Nav.portfolioOverview", icon: Dashboard },
    { id: "tasks", labelKey: "Nav.avalTasks", icon: TaskList, count: 4 },
    { id: "reviewCenter", labelKey: "Nav.reviewCenter", icon: ClipboardCheck },
    { id: "inbox", labelKey: "Nav.sharedInbox", icon: ChatLines, count: 7 },
  ]},
  { labelKey: "Nav.operations", items: [
    { id: "properties", labelKey: "Nav.properties", icon: HomeSimpleDoor },
    { id: "leasing", labelKey: "Nav.leasing", icon: User },
    { id: "maintenance", labelKey: "Nav.maintenance", icon: Tools },
    { id: "accounting", labelKey: "Nav.accounting", icon: CoinsSwap },
  ]},
  { labelKey: "Nav.workspace", items: [
    { id: "connections", labelKey: "Nav.connections", icon: NetworkLeft },
    { id: "documents", labelKey: "Nav.documents", icon: Page },
    { id: "settings", labelKey: "Nav.settings", icon: Settings },
  ]},
];

const fallbackProviders: Provider[] = [
  { id: "quickbooks", title: "QuickBooks Online", category: "Accounting", description: "Receivables, payments, invoices, and operating reports.", authMode: "oauth2", permissions: ["Accounting data"], env: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"], webhook: true, readOnly: true, note: "Read-only API calls after OAuth.", configured: false },
  { id: "xero", title: "Xero", category: "Accounting", description: "Invoices, bank transactions, payments, contacts, and reports.", authMode: "oauth2", permissions: ["Granular accounting read scopes"], env: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Uses granular read scopes.", configured: false },
  { id: "contpaqi", title: "CONTPAQi", category: "Accounting", description: "Facturación, cuentas por cobrar, y reportes contables para operadores en México.", authMode: "api_key", permissions: ["Accounting data"], credentialFields: [{ key: "apiKey", label: "CONTPAQi API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Requires a CONTPAQi license with API access enabled.", configured: false },
  { id: "alegra", title: "Alegra", category: "Accounting", description: "Facturación, cuentas por cobrar y pagos para pequeñas y medianas empresas en LatAm.", authMode: "api_key", permissions: ["Accounting data"], credentialFields: [{ key: "apiKey", label: "Alegra API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Authenticates with an Alegra API key.", configured: false },
  { id: "appfolio", title: "AppFolio", category: "Leasing & PMS", description: "Inquiries, showings, applications, leases, tenants, and ledgers.", authMode: "credentials", permissions: ["Rental applications", "Showings", "Tenant ledgers"], credentialFields: [{ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret", secret: true }, { key: "database", label: "Database name" }], env: [], webhook: false, readOnly: true, note: "Requires enabled AppFolio Stack API products.", configured: true },
  { id: "buildium", title: "Buildium", category: "Leasing & PMS", description: "Rentals, applicants, leases, tasks, and accounting data.", authMode: "credentials", permissions: ["Rentals", "Applicants", "Leases"], credentialFields: [{ key: "clientId", label: "Buildium client ID" }, { key: "clientSecret", label: "Buildium client secret", secret: true }], env: [], webhook: false, readOnly: true, note: "Server-to-server client headers.", configured: true },
  { id: "yardi", title: "Yardi", category: "Leasing & PMS", description: "Resident, lease, and general-ledger data from Yardi Voyager or Breeze.", authMode: "credentials", permissions: ["Resident data", "Leases", "General ledger"], credentialFields: [{ key: "interfaceId", label: "Yardi interface ID" }, { key: "interfaceKey", label: "Yardi interface key", secret: true }], env: [], webhook: false, readOnly: true, note: "Requires an approved Yardi Interface Partner agreement. No self-serve signup.", configured: true },
  { id: "realpage", title: "RealPage", category: "Leasing & PMS", description: "Leasing, resident, and accounting data from RealPage's enterprise multifamily platform.", authMode: "credentials", permissions: ["Resident data", "Leases", "Accounting data"], credentialFields: [{ key: "clientId", label: "RealPage Exchange client ID" }, { key: "clientSecret", label: "RealPage Exchange client secret", secret: true }], env: [], webhook: false, readOnly: true, note: "Granted only through the RealPage Exchange partner program. Sales-led, not self-serve.", configured: true },
  { id: "entrata", title: "Entrata", category: "Leasing & PMS", description: "Leases, resident profiles, and accounting data from Entrata's multifamily suite.", authMode: "credentials", permissions: ["Leases", "Resident profiles", "Accounting data"], credentialFields: [{ key: "apiUser", label: "Entrata API user" }, { key: "apiPassword", label: "Entrata API password", secret: true }], env: [], webhook: false, readOnly: true, note: "Requires a signed API Developer Interface Agreement and IP allowlisting.", configured: true },
  { id: "rentmanager", title: "Rent Manager", category: "Leasing & PMS", description: "Rentals, tenants, work orders, and accounting data from Rent Manager.", authMode: "credentials", permissions: ["Rentals", "Tenants", "Work orders", "Accounting"], credentialFields: [{ key: "apiKey", label: "Rent Manager API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Requires enrollment in Rent Manager's Integrations Program, not a public self-serve key.", configured: true },
  { id: "doorloop", title: "DoorLoop", category: "Leasing & PMS", description: "Rentals, leases, tenants, and accounting data from DoorLoop.", authMode: "api_key", permissions: ["Rentals", "Leases", "Tenants", "Accounting"], credentialFields: [{ key: "apiKey", label: "DoorLoop API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Public, self-serve API key generated in DoorLoop account settings.", configured: true },
  { id: "whatsapp", title: "WhatsApp Business", category: "Communication", description: "Tenant messaging through Meta's Cloud API.", authMode: "credentials", permissions: ["Messages", "Business account"], credentialFields: [{ key: "businessAccountId", label: "WhatsApp Business Account ID" }, { key: "phoneNumberId", label: "Phone number ID" }, { key: "accessToken", label: "Permanent system-user access token", secret: true }], env: ["META_WHATSAPP_APP_SECRET", "META_WHATSAPP_VERIFY_TOKEN", "META_GRAPH_API_VERSION"], webhook: true, readOnly: false, note: "Signed webhook verification is required.", configured: false },
  { id: "whatsapp_personal", title: "WhatsApp (Personal)", category: "Communication", description: "For teams messaging tenants from a personal WhatsApp number instead of a Business account.", authMode: "qr_link", permissions: ["Messages"], env: [], webhook: true, readOnly: false, note: "Links via a QR-paired companion device, the same mechanism as WhatsApp Web. Less reliable than the official Business API and outside WhatsApp's own terms for automated use.", configured: true },
  { id: "apple_messages", title: "Apple Messages", category: "Communication", description: "Apple Messages for Business via an approved messaging provider.", authMode: "msp", permissions: ["Business registration", "MSP routing"], credentialFields: [{ key: "provider", label: "Messaging Service Provider" }, { key: "webhookSecret", label: "Webhook signing secret", secret: true }], env: [], webhook: true, readOnly: false, note: "Apple does not expose direct iMessage OAuth.", configured: true },
  { id: "slack", title: "Slack", category: "Communication", description: "Selected channels, approvals, and task updates.", authMode: "oauth2", permissions: ["Channel history", "Post messages", "Users"], env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"], webhook: true, readOnly: false, note: "Workspace admins choose channels during OAuth.", configured: false },
  { id: "notion", title: "Notion", category: "Knowledge", description: "Only pages and databases explicitly shared with Aval.", authMode: "oauth2", permissions: ["Selected pages and databases"], env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"], webhook: false, readOnly: true, note: "The authorization screen controls page access.", configured: false },
  { id: "outlook", title: "Outlook", category: "Communication", description: "Selected mail and calendar context through Microsoft Graph.", authMode: "oauth2", permissions: ["Mail.Read", "Calendars.Read"], env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Delegated access only.", configured: false },
  { id: "gmail", title: "Gmail", category: "Communication", description: "Read-only property operations email and threads.", authMode: "oauth2", permissions: ["gmail.readonly"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], webhook: false, readOnly: true, note: "Google verification is required before public use.", configured: false },
  { id: "telegram", title: "Telegram", category: "Communication", description: "A tenant and contractor bot with verified webhook updates.", authMode: "bot_token", permissions: ["Bot messages", "Updates"], credentialFields: [{ key: "botToken", label: "Bot token", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true }], env: [], webhook: true, readOnly: false, note: "Telegram secret-token validation is built in.", configured: true },
  { id: "twilio", title: "Calls & SMS", category: "Communication", description: "Calls, SMS, recordings, and resident timeline context.", authMode: "credentials", permissions: ["Calls", "Messages", "Recordings"], credentialFields: [{ key: "accountSid", label: "Account SID" }, { key: "authToken", label: "Auth token", secret: true }], env: [], webhook: true, readOnly: false, note: "Twilio-compatible telephony.", configured: true },
  { id: "granola", title: "Granola", category: "Knowledge", description: "Meeting notes, transcripts, participants, and follow-ups.", authMode: "api_key", permissions: ["Meeting notes", "Transcripts"], credentialFields: [{ key: "apiKey", label: "Granola Business API key", secret: true }], env: [], webhook: false, readOnly: true, note: "Requires a Business workspace API key.", configured: true },
];
const providerOrder = ["whatsapp", "whatsapp_personal", "apple_messages", "slack", "notion", "outlook", "gmail", "telegram", "twilio", "granola"];
const pmsProviderOrder = ["appfolio", "buildium", "yardi", "realpage", "entrata", "rentmanager", "doorloop"];

const guides: Record<string, { aval: string[]; customer: string[]; proof: string }> = {
  quickbooks: { aval: ["Intuit production app, callback URL, and accounting scope", "Encrypted refresh-token rotation", "Webhook handling for changed entities"], customer: ["QuickBooks Online administrator", "Select the correct company during consent", "Approve a read-only data check"], proof: "OAuth must return and store the selected company realm." },
  xero: { aval: ["Xero OAuth app and exact callback URL", "2026 granular read scopes plus offline_access", "Tenant-aware sync"], customer: ["Standard or adviser role", "Choose the correct Xero organisation", "Confirm invoices, payments, bank transactions, and reports"], proof: "Aval must store the selected tenant ID." },
  appfolio: { aval: ["Approved AppFolio Stack partnership", "Contracted API products", "Database-to-portfolio field map"], customer: ["Ask AppFolio to enable agreed API products", "Provide database and issued credentials", "Approve a historical sync window"], proof: "Credentials cannot work until AppFolio enables each product." },
  buildium: { aval: ["Buildium client-header adapter", "Ten-concurrent-request limit", "Pagination and source-ID checkpoints"], customer: ["Buildium API subscription", "Client ID and secret", "Confirm rentals, applicants, leases, tasks, and accounting"], proof: "Aval calls the official rentals endpoint before marking connected." },
  yardi: { aval: ["Approved Yardi Interface Partner status", "Per-interface licensing agreement", "Voyager/Breeze field mapping"], customer: ["Yardi property management agreement", "Interface enabled by your Yardi account team", "Approve a historical sync window"], proof: "Credentials cannot work until Yardi's partner team issues an interface." },
  realpage: { aval: ["RealPage Exchange partner enrollment", "AppPartner integration agreement", "Field mapping to Aval's internal model"], customer: ["RealPage account team introduction", "RealPage Exchange access request", "Approve a historical sync window"], proof: "Aval calls the RealPage Exchange endpoint before marking connected." },
  entrata: { aval: ["Signed API Developer Interface Agreement", "IP allowlisting", "Entrata field mapping"], customer: ["Entrata administrator", "Request API access from Entrata support", "Provide the IP ranges to allowlist"], proof: "Entrata rejects calls from outside the agreed IP range until this is complete." },
  rentmanager: { aval: ["Rent Manager Integrations Program enrollment", "API key adapter", "Field mapping to Aval's internal model"], customer: ["Rent Manager account", "Enroll in the Integrations Program", "Issue an API key to Aval"], proof: "Aval calls the Rent Manager API before marking connected." },
  doorloop: { aval: ["Public API adapter", "Rate-limit aware sync", "Field mapping to Aval's internal model"], customer: ["DoorLoop account", "Generate an API key in Settings", "Confirm rentals, leases, tenants, and accounting"], proof: "Aval calls the DoorLoop API before marking connected." },
  whatsapp: { aval: ["Meta app, Graph version, app secret, verify token", "Signed HTTPS webhook", "Approved outbound message templates"], customer: ["Verified Meta Business portfolio", "Registered WhatsApp number", "Permanent system-user token, WABA ID, and Phone Number ID"], proof: "Aval reads the phone-number record before accepting signed events." },
  whatsapp_personal: { aval: ["Linked-device session manager", "QR refresh and reconnect handling", "Rate-limit aware send queue"], customer: ["A phone with WhatsApp installed", "Scan the QR code Aval shows you", "Keep that phone connected to the internet"], proof: "Aval confirms the linked session is active before marking this connected, the same handshake WhatsApp Web uses." },
  apple_messages: { aval: ["Messages for Business approval", "Apple-approved Messaging Service Provider", "MSP webhook/send adapter"], customer: ["Register the brand and entry points", "Choose an approved MSP", "Complete Apple/MSP launch review"], proof: "There is no direct consumer iMessage API or OAuth shortcut." },
  slack: { aval: ["Slack app, redirect, event subscriptions, signing secret", "Least-privilege bot scopes", "Fast acknowledgement and async event processing"], customer: ["Workspace administrator", "Choose workspace and channels", "Invite the bot to private channels"], proof: "OAuth identifies the workspace; signed events prove origin." },
  notion: { aval: ["Public Notion integration and redirect", "Encrypted credentials", "Page-level sync cursor"], customer: ["Authorised workspace member", "Choose pages in Notion's page picker", "Share additional pages later"], proof: "Aval sees only explicitly selected content." },
  outlook: { aval: ["Microsoft Entra app and redirect", "Delegated Mail.Read and Calendars.Read", "Optional renewable Graph subscriptions"], customer: ["Microsoft 365 account", "Tenant consent if policy requires", "Choose the operational mailbox/calendar"], proof: "No app-wide mailbox permission is requested." },
  gmail: { aval: ["Verified Google OAuth consent screen", "Restricted-scope verification/security review", "Pub/Sub and renewable users.watch for push"], customer: ["Google Workspace account", "Admin approval if apps are restricted", "Choose the operational mailbox"], proof: "Without push, Aval uses scheduled incremental history sync." },
  telegram: { aval: ["HTTPS webhook and secret-token validation", "Update normalization", "Outbound rate handling"], customer: ["Create a bot with BotFather", "Copy token and generate webhook secret", "Add bot to the required chats"], proof: "Aval calls getMe, then installs a verified webhook." },
  twilio: { aval: ["Official webhook-signature validation", "Voice/SMS event mapping", "Recording consent policy"], customer: ["Twilio account and number", "Account SID and auth token", "Point voice/message webhooks to Aval"], proof: "Aval fetches the upstream Twilio account first." },
  granola: { aval: ["Public API adapter", "Scoped note ingestion", "Separate optional MCP flow"], customer: ["Granola Business workspace", "Workspace API key with note scopes", "Choose personal/public note access"], proof: "The public API check is distinct from Granola MCP browser OAuth." },
};

const PIPELINE_STAGES: { id: string; icon: IconComponent; labelKey: string; detailKey: string }[] = [
  { id: "authorize", icon: Key, labelKey: "ConnectionDialog.authorize", detailKey: "ConnectionsView.pipelineAuthorizeDetail" },
  { id: "verify", icon: ShieldCheck, labelKey: "ConnectionDialog.verify", detailKey: "ConnectionsView.pipelineVerifyDetail" },
  { id: "normalize", icon: NetworkLeft, labelKey: "ConnectionDialog.normalize", detailKey: "ConnectionsView.pipelineNormalizeDetail" },
  { id: "readModels", icon: Database, labelKey: "ConnectionsView.pipelineReadModels", detailKey: "ConnectionsView.pipelineReadModelsDetail" },
];

function SimpleMark({ icon }: { icon: { path: string; hex: string; title: string } }) { return <svg viewBox="0 0 24 24" aria-label={icon.title} role="img"><path fill={`#${icon.hex}`} d={icon.path}/></svg>; }
function SlackMark() { return <svg viewBox="0 0 24 24" aria-label="Slack" role="img"><path fill="#36C5F0" d="M5.2 0a2.4 2.4 0 0 0 0 4.8h2.4V2.4A2.4 2.4 0 0 0 5.2 0m0 6.4H2.4a2.4 2.4 0 0 0 0 4.8h2.8z"/><path fill="#2EB67D" d="M24 5.2a2.4 2.4 0 0 0-4.8 0v2.4h2.4A2.4 2.4 0 0 0 24 5.2m-6.4 0V2.4a2.4 2.4 0 0 0-4.8 0v2.8z"/><path fill="#ECB22E" d="M18.8 24a2.4 2.4 0 0 0 0-4.8h-2.4v2.4a2.4 2.4 0 0 0 2.4 2.4m0-6.4h2.8a2.4 2.4 0 0 0 0-4.8h-2.8z"/><path fill="#E01E5A" d="M0 18.8a2.4 2.4 0 0 0 4.8 0v-2.4H2.4A2.4 2.4 0 0 0 0 18.8m6.4 0v2.8a2.4 2.4 0 0 0 4.8 0v-2.8z"/></svg>; }
function OutlookMark() { return <svg viewBox="0 0 24 24" aria-label="Microsoft Outlook" role="img"><path fill="#0A64C9" d="M1 4.8 11.1 3v18L1 19.2z"/><path fill="#1976D2" d="M12.3 5h10.3v14H12.3z"/><path fill="#fff" d="M12.3 8.3h10.3v1.2l-5.1 3.9-5.2-3.9zM4 8h4.2c2.3 0 3.6 1.6 3.6 4s-1.3 4-3.7 4H4zm2.2 1.8v4.4h1.7c1.1 0 1.7-.8 1.7-2.2s-.6-2.2-1.7-2.2z"/></svg>; }
function TwilioMark() { return <svg viewBox="0 0 24 24" aria-label="Twilio" role="img"><circle cx="12" cy="12" r="10" fill="#F22F46"/><g fill="#fff"><circle cx="8.6" cy="8.6" r="2.1"/><circle cx="15.4" cy="8.6" r="2.1"/><circle cx="8.6" cy="15.4" r="2.1"/><circle cx="15.4" cy="15.4" r="2.1"/></g></svg>; }
// A stylized, deterministic QR-like pattern for the WhatsApp Personal linking
// flow — decorative only (no real pairing session exists in sample mode),
// not a scannable code. Generated once with a seeded PRNG so it's stable
// across renders instead of reshuffling on every re-render.
const QR_DATA_CELLS: [number, number][] = (() => {
  const size = 29;
  const inFinderZone = (x: number, y: number) => (x < 8 && y < 8) || (x >= 21 && y < 8) || (x < 8 && y >= 21);
  const cells: [number, number][] = [];
  let seed = 42;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinderZone(x, y)) continue;
      if (next() < 0.42) cells.push([x, y]);
    }
  }
  return cells;
})();
function QrPlaceholder() {
  return (
    <svg viewBox="0 0 29 29" className="qr-placeholder" role="img" aria-hidden="true">
      <rect width="29" height="29" fill="white"/>
      {([[0, 0], [22, 0], [0, 22]] as const).map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="7" height="7" fill="black"/>
          <rect x={x + 1} y={y + 1} width="5" height="5" fill="white"/>
          <rect x={x + 2} y={y + 2} width="3" height="3" fill="black"/>
        </g>
      ))}
      {QR_DATA_CELLS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="black"/>)}
    </svg>
  );
}
function BrandMark({ provider, small = false }: { provider: string; small?: boolean }) {
  const inner = provider === "whatsapp" ? <SimpleMark icon={siWhatsapp}/> : provider === "apple_messages" ? <SimpleMark icon={siApple}/> : provider === "slack" ? <SlackMark/> : provider === "notion" ? <SimpleMark icon={siNotion}/> : provider === "outlook" ? <OutlookMark/> : provider === "gmail" ? <SimpleMark icon={siGmail}/> : provider === "telegram" ? <SimpleMark icon={siTelegram}/> : provider === "twilio" ? <TwilioMark/> : provider === "quickbooks" ? <SimpleMark icon={siQuickbooks}/> : provider === "xero" ? <SimpleMark icon={siXero}/> : provider === "appfolio" ? <span className="wordmark appfolio-mark">a</span> : provider === "buildium" ? <span className="wordmark buildium-mark">B</span> : provider === "granola" ? <span className="wordmark granola-mark">g</span> : provider === "contpaqi" ? <span className="wordmark contpaqi-mark">C</span> : provider === "alegra" ? <span className="wordmark alegra-mark">A</span> : provider === "yardi" ? <span className="wordmark yardi-mark">Y</span> : provider === "realpage" ? <span className="wordmark realpage-mark">R</span> : provider === "entrata" ? <span className="wordmark entrata-mark">E</span> : provider === "rentmanager" ? <span className="wordmark rentmanager-mark">RM</span> : provider === "doorloop" ? <span className="wordmark doorloop-mark">D</span> : provider === "whatsapp_personal" ? <SimpleMark icon={siWhatsapp}/> : provider === "aval" ? <span className="wordmark aval-mark">a</span> : <Database width={22} height={22}/>;
  return <span className={`brand-mark ${small ? "small" : ""} brand-${provider}`}>{inner}</span>;
}
function formatMinutesAgo(minutesAgo: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutesAgo < 60) return rtf.format(-minutesAgo, "minute");
  const hours = Math.round(minutesAgo / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

function AppHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) { const t = useTranslations(); return <header className="app-header"><div><p className="eyebrow">{t("DesktopApp.avalWorkspaceEyebrow")}</p><h1>{title}</h1>{subtitle && <p className="header-subtitle">{subtitle}</p>}</div><div className="header-actions">{actions}<button className="icon-button" onClick={() => window.dispatchEvent(new Event("aval:notifications"))} aria-label={t("DesktopApp.notificationsLabel")}><Bell width={20} height={20}/><span className="notification-dot"/></button></div></header>; }

const metricTiles = [
  {
    key: "noi", labelKey: sampleData.noi.labelKey, value: sampleData.noi.value, prefix: "$", suffix: "", decimals: 0,
    deltaText: `+${derivedSample.noiDeltaPct.toFixed(1)}%`, detailKey: sampleData.noi.detailKey, detailParams: undefined as Record<string, number> | undefined, bars: sampleData.noi.bars,
    emptyDescriptionKey: "Overview.noiEmptyDescription",
  },
  {
    key: "economicOccupancy", labelKey: sampleData.economicOccupancy.labelKey, value: sampleData.economicOccupancy.value, prefix: "", suffix: "%", decimals: 1,
    deltaText: `+${derivedSample.occupancyDeltaPct.toFixed(1)}%`, detailKey: sampleData.economicOccupancy.detailKey, detailParams: undefined as Record<string, number> | undefined, bars: sampleData.economicOccupancy.bars,
    emptyDescriptionKey: "Overview.occupancyEmptyDescription",
  },
  {
    key: "rentCollected", labelKey: sampleData.rentCollected.labelKey, value: sampleData.rentCollected.value, prefix: "$", suffix: "", decimals: 0,
    deltaText: `${derivedSample.rentCollectedPct.toFixed(1)}%`, detailKey: sampleData.rentCollected.detailKey, detailParams: undefined as Record<string, number> | undefined, bars: sampleData.rentCollected.bars,
    emptyDescriptionKey: "Overview.rentCollectedEmptyDescription",
  },
  {
    key: "openWorkOrders", labelKey: sampleData.openWorkOrders.labelKey, value: sampleData.openWorkOrders.value, prefix: "", suffix: "", decimals: 0,
    deltaText: `${sampleData.openWorkOrders.urgent} urgent`,
    detailKey: sampleData.openWorkOrders.detailKey, detailParams: { days: sampleData.openWorkOrders.avgCloseDays },
    bars: sampleData.openWorkOrders.bars,
    emptyDescriptionKey: "Overview.workOrdersEmptyDescription",
  },
] as const;
const funnelStageWidths: Record<typeof sampleData.funnel.stages[number]["key"], string> = {
  contacted: "100%", viewed: "78%", applied: "56%", signed: "40%",
};
const funnelStages = sampleData.funnel.stages.map((stage) => ({ ...stage, width: funnelStageWidths[stage.key] }));

// Which connected provider categories each Overview tile needs before it can show real data.
// economicOccupancy needs both — it's computed from accounting revenue and leasing occupancy together.
const TILE_SOURCES: Record<(typeof metricTiles)[number]["key"] | "funnel", string[]> = {
  noi: ["Accounting"],
  economicOccupancy: ["Accounting", "Leasing & PMS"],
  rentCollected: ["Accounting"],
  openWorkOrders: ["Leasing & PMS"],
  funnel: ["Leasing & PMS"],
};

// Static for now — this is the seam where a connected model would draft the
// actual review text instead. The numbers it references are always real
// (moneyAtStake, the NOI delta), never invented for the draft. Shared by
// Overview's insight queue and the Review Center so the exact same draft
// text is shown wherever an insight is opened.
function draftText(insight: InsightCandidate, t: T, money: (amount: number) => string): string {
  if (!insight.draftKey) return "";
  if (insight.id === "vacancy-pricing") return t(insight.draftKey, { amount: money(insight.moneyAtStake) });
  if (insight.id === "noi-variance") return t(insight.draftKey, { delta: `+${derivedSample.noiDeltaPct.toFixed(1)}%` });
  return t(insight.draftKey);
}

const REVIEW_STATUS_ICON: Record<ReviewStatus, IconComponent> = {
  pending: Clock, approved: CheckCircle, sent: CheckCircle, denied: XmarkCircle,
};
const REVIEW_STATUS_LABEL_KEY: Record<ReviewStatus, string> = {
  pending: "ReviewCenter.statusPending", approved: "ReviewCenter.statusApproved",
  sent: "ReviewCenter.statusSent", denied: "ReviewCenter.statusDenied",
};

/**
 * The drafted-review dialog: NOI waterfall or evidence rows, the drafted
 * text, and Approve/Deny while pending — or a read-only status badge once
 * decided. Used both from Overview's insight queue (via a notification or
 * the queue itself) and from the Review Center, so a decision made in
 * either place is reflected identically in the other.
 */
function ReviewDraftDialog({ insight, status, expanded, onToggleExpand, onOpenChange, onApprove, onDeny, t, money }: {
  insight: InsightCandidate | null; status: ReviewStatus | undefined; expanded: boolean;
  onToggleExpand: () => void; onOpenChange: (open: boolean) => void; onApprove: () => void; onDeny: () => void;
  t: T; money: (amount: number) => string;
}) {
  return (
    <Dialog.Root open={insight !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className={`small-dialog review-draft-dialog${expanded ? " expanded" : ""}`}>
          {insight && <>
            <div className="dialog-top">
              <div>
                <p className="eyebrow">{status === "approved" ? t("Overview.approvedReviewEyebrow") : status === "denied" ? t("Overview.deniedReviewEyebrow") : t("Overview.draftedReviewEyebrow")}</p>
                <Dialog.Title>{t(insight.titleKey)}</Dialog.Title>
              </div>
              <div className="dialog-top-actions">
                <button className="icon-button" onClick={onToggleExpand} aria-label={expanded ? t("Overview.collapseDraft") : t("Overview.expandDraft")}>
                  {expanded ? <ScaleFrameReduce width={19} height={19}/> : <ScaleFrameEnlarge width={19} height={19}/>}
                </button>
                <Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close>
              </div>
            </div>
            {insight.tileKey === "noi" && <NoiWaterfall t={t} money={money}/>}
            {insight.evidence.length > 0 && <div className="evidence-rows">{insight.evidence.map((row) => <div className="evidence-row" key={row.labelKey}><div><strong>{t(row.labelKey)}</strong><small>{t(row.detailKey)}</small></div><span>{money(row.amount)}</span></div>)}</div>}
            <p className="review-draft-text">{draftText(insight, t, money)}</p>
            <div className="dialog-actions">
              {status === "approved"
                ? <span className="approved-badge"><CheckCircle width={15} height={15}/>{t("Overview.approvedBadge")}</span>
                : status === "denied"
                ? <span className="denied-badge"><XmarkCircle width={15} height={15}/>{t("Overview.deniedBadge")}</span>
                : <>
                    <button className="soft-button" onClick={onDeny}>{t("Overview.denyDraft")}</button>
                    <Dialog.Close className="soft-button">{t("Overview.cancel")}</Dialog.Close>
                    <button className="primary-button" onClick={onApprove}>{t("Overview.approveDraft")}</button>
                  </>}
            </div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Read-only receipt for an already-sent reminder batch: who got it, via which channel, and the message they actually received. */
function ReviewReceiptDialog({ insight, recipients, onOpenChange, t, money }: {
  insight: InsightCandidate | null; recipients: InsightRecipient[]; onOpenChange: (open: boolean) => void; t: T; money: (amount: number) => string;
}) {
  const messageKey = insight?.action?.type === "sendReminders" ? insight.action.messageKey : undefined;
  return (
    <Dialog.Root open={insight !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="small-dialog">
          {insight && <>
            <div className="dialog-top">
              <div><p className="eyebrow">{t("Overview.receiptEyebrow")}</p><Dialog.Title>{t(insight.titleKey)}</Dialog.Title></div>
              <Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close>
            </div>
            {messageKey && recipients[0] && <div className="review-message-preview">
              <p className="eyebrow">{t("Overview.messageSentEyebrow")}</p>
              <p>{t(messageKey, { name: recipients[0].name, amount: money(recipients[0].amount) })}</p>
            </div>}
            <div className="recipient-list">{recipients.map((recipient) => <div className="recipient-row" key={recipient.name}>
              <BrandMark provider={recipient.channel} small/>
              <div><strong>{recipient.name}</strong><small>{t(recipient.detailKey)}</small></div>
              <span>{money(recipient.amount)}</span>
              <CheckCircle className="receipt-sent-icon" width={16} height={16}/>
            </div>)}</div>
            <div className="dialog-actions"><Dialog.Close className="soft-button">{t("Overview.close")}</Dialog.Close></div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The pending reminder-batch compose flow: remove a recipient from the batch, then Deny it outright or Send it. */
function ReminderPreviewDialog({ insight, removedRecipients, onRemoveRecipient, onOpenChange, onSend, onDeny, t, money }: {
  insight: InsightCandidate | null; removedRecipients: Set<string>; onRemoveRecipient: (name: string) => void;
  onOpenChange: (open: boolean) => void; onSend: (recipients: InsightRecipient[]) => void; onDeny: () => void;
  t: T; money: (amount: number) => string;
}) {
  return (
    <Dialog.Root open={insight !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="small-dialog">
          {insight && insight.action?.type === "sendReminders" && (() => {
            const visible = insight.action.recipients.filter((recipient) => !removedRecipients.has(recipient.name));
            return <>
              <div className="dialog-top"><Dialog.Title>{t("Overview.sendRemindersTitle", { count: visible.length })}</Dialog.Title><Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close></div>
              <div className="recipient-list">{visible.map((recipient) => <div className="recipient-row" key={recipient.name}>
                <BrandMark provider={recipient.channel} small/>
                <div><strong>{recipient.name}</strong><small>{t(recipient.detailKey)}</small></div>
                <span>{money(recipient.amount)}</span>
                <button className="icon-button" onClick={() => onRemoveRecipient(recipient.name)} aria-label={t("Overview.removeRecipient")}><Xmark width={15} height={15}/></button>
              </div>)}</div>
              <div className="dialog-actions">
                <button className="soft-button" onClick={onDeny}>{t("Overview.denyDraft")}</button>
                <Dialog.Close className="soft-button">{t("Overview.cancel")}</Dialog.Close>
                <button className="primary-button" disabled={visible.length === 0} onClick={() => onSend(visible)}>{t("Overview.sendRemindersConfirm", { count: visible.length })}</button>
              </div>
            </>;
          })()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Fixed "today" for every date-range computation below — this app runs on
// static sample data anchored to mid-August 2026 (the leasing trend's six
// weeks, the history entries' relative timestamps), so presets and the
// custom calendar's "no future dates" rule need a stable reference instead
// of the real current date.
const SAMPLE_TODAY = new Date(2026, 7, 18);
function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
function startOfQuarter(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatDateRange(start: Date, end: Date, locale: string): string {
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
  const dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric" });
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${monthFmt.format(start)} ${dayFmt.format(start)}–${dayFmt.format(end)}`
    : `${monthFmt.format(start)} ${dayFmt.format(start)} – ${monthFmt.format(end)} ${dayFmt.format(end)}`;
}
function buildMonthCells(year: number, month: number): (Date | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= totalDays; day++) cells.push(new Date(year, month, day));
  return cells;
}
// Real property-management calendar shapes, not arbitrary day counts: a
// billing week, the same six-week window the leasing trend chart shows,
// month-to-date, quarter-to-date, and year-to-date.
const DATE_PRESETS: { labelKey: string; range: [Date, Date] }[] = [
  { labelKey: "Overview.periodThisWeek", range: [addDays(SAMPLE_TODAY, -6), SAMPLE_TODAY] },
  { labelKey: "Overview.periodLast6Weeks", range: [addDays(SAMPLE_TODAY, -41), SAMPLE_TODAY] },
  { labelKey: "Overview.periodThisMonth", range: [new Date(SAMPLE_TODAY.getFullYear(), SAMPLE_TODAY.getMonth(), 1), SAMPLE_TODAY] },
  { labelKey: "Overview.periodThisQuarter", range: [startOfQuarter(SAMPLE_TODAY), SAMPLE_TODAY] },
  { labelKey: "Overview.periodYearToDate", range: [new Date(SAMPLE_TODAY.getFullYear(), 0, 1), SAMPLE_TODAY] },
];

/**
 * Preset list by default; "Custom range" swaps in a two-month drag-select
 * calendar (click a start day, hover previews the range, click an end day
 * to apply) — the same click-then-click interaction flight-booking date
 * pickers use. Days after SAMPLE_TODAY are disabled: sample data has
 * nothing to show for a period that hasn't happened yet.
 */
function DateRangePicker({ period, onChange, t, locale }: { period: string; onChange: (label: string) => void; t: T; locale: string }) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date(SAMPLE_TODAY.getFullYear(), SAMPLE_TODAY.getMonth() - 1, 1));
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeHover, setRangeHover] = useState<Date | null>(null);

  const closeMenu = () => { setOpen(false); setCustomMode(false); setRangeStart(null); setRangeHover(null); };
  const backToPresets = () => { setCustomMode(false); setRangeStart(null); setRangeHover(null); };

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    onChange(formatDateRange(preset.range[0], preset.range[1], locale));
    closeMenu();
  };

  const handleDayClick = (day: Date) => {
    if (day > SAMPLE_TODAY) return;
    if (!rangeStart) { setRangeStart(day); setRangeHover(day); return; }
    const [start, end] = day < rangeStart ? [day, rangeStart] : [rangeStart, day];
    onChange(formatDateRange(start, end, locale));
    closeMenu();
  };

  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monthYearFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const dayLabelFmt = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => weekdayFmt.format(new Date(2026, 7, 9 + index)));
  const months = [calendarAnchor, new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + 1, 1)];
  const rangeBounds = rangeStart && rangeHover ? (rangeHover < rangeStart ? [rangeHover, rangeStart] : [rangeStart, rangeHover]) : null;

  return (
    <details className="app-menu date-range-menu" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="soft-button"><Calendar width={18} height={18}/>{period}<NavArrowDown width={16} height={16}/></summary>
      <div className="menu-popover date-range-popover">
        {!customMode
          ? <div className="date-preset-list">
              {DATE_PRESETS.map((preset) => <button type="button" key={preset.labelKey} onClick={() => applyPreset(preset)}>{t(preset.labelKey)}</button>)}
              <button type="button" className="date-custom-trigger" onClick={() => setCustomMode(true)}>{t("Overview.periodCustomRange")}<NavArrowRight width={14} height={14}/></button>
            </div>
          : <div className="date-calendar">
              <div className="date-calendar-nav">
                <button type="button" className="icon-button" onClick={() => setCalendarAnchor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label={t("Overview.previousMonth")}><NavArrowLeft width={16} height={16}/></button>
                <button type="button" className="text-button" onClick={backToPresets}>{t("Overview.backToPresets")}</button>
                <button type="button" className="icon-button" onClick={() => setCalendarAnchor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label={t("Overview.nextMonth")}><NavArrowRight width={16} height={16}/></button>
              </div>
              <div className="date-calendar-months">
                {months.map((monthDate) => (
                  <div className="date-calendar-month" key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}>
                    <p className="date-calendar-month-label">{monthYearFmt.format(monthDate)}</p>
                    <div className="date-calendar-weekdays">{weekdayLabels.map((label, index) => <span key={index}>{label}</span>)}</div>
                    <div className="date-calendar-grid">
                      {buildMonthCells(monthDate.getFullYear(), monthDate.getMonth()).map((day, index) => {
                        if (!day) return <span key={index}/>;
                        const isFuture = day > SAMPLE_TODAY;
                        const isEdge = (rangeStart && isSameDay(day, rangeStart)) || (rangeHover && isSameDay(day, rangeHover));
                        const inRange = rangeBounds !== null && day >= rangeBounds[0] && day <= rangeBounds[1];
                        return (
                          <button
                            type="button" key={index}
                            className={`date-calendar-day${isEdge ? " selected" : ""}${inRange ? " in-range" : ""}${isSameDay(day, SAMPLE_TODAY) ? " today" : ""}`}
                            disabled={isFuture}
                            onClick={() => handleDayClick(day)}
                            onMouseEnter={() => rangeStart && setRangeHover(day)}
                            aria-label={dayLabelFmt.format(day)}
                          >{day.getDate()}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="date-calendar-hint">{rangeStart ? t("Overview.selectEndDate") : t("Overview.selectStartDate")}</p>
            </div>}
      </div>
    </details>
  );
}

function Overview({ openConnections, dataMode, providers, pendingTarget, targetToken, reviewStatuses, sentReceipts, onApprove, onDeny, onSendReminders }: {
  openConnections: () => void; dataMode: DataMode; providers: Provider[];
  pendingTarget: NotificationTarget | null; targetToken: number;
  reviewStatuses: Record<string, ReviewStatus>; sentReceipts: Record<string, InsightRecipient[]>;
  onApprove: (insight: InsightCandidate) => void; onDeny: (insight: InsightCandidate) => void;
  onSendReminders: (insight: InsightCandidate, recipients: InsightRecipient[]) => void;
}) {
  const { market } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const currencyPrefix = market === "latam" ? "MX$" : "$";
  const accountingProvider = market === "latam" ? "contpaqi" : "quickbooks";
  const [period, setPeriod] = useState("Aug 12–18");
  const [chipDismissed, setChipDismissed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftExpanded, setDraftExpanded] = useState(false);
  const isSample = dataMode === "sample";
  const showChip = isSample && !chipDismissed;
  const connectedCategories = useMemo(() => new Set(providers.filter((provider) => provider.connection?.status === "connected").map((provider) => provider.category)), [providers]);
  const isTileConnected = (key: keyof typeof TILE_SOURCES) => TILE_SOURCES[key].every((category) => connectedCategories.has(category));
  const resolveCoverageProvider = (row: (typeof sampleData.coverage.rows)[number]) => row.provider === "quickbooks" ? accountingProvider : row.provider;
  const isCoverageRowConnected = (row: (typeof sampleData.coverage.rows)[number]) => providers.find((provider) => provider.id === resolveCoverageProvider(row))?.connection?.status === "connected";
  const connectedCount = sampleData.coverage.rows.filter(isCoverageRowConnected).length;
  const [drillDown, setDrillDown] = useState<"noi" | "economicOccupancy" | "rentCollected" | "openWorkOrders" | null>(null);
  const [reminderPreview, setReminderPreview] = useState<InsightCandidate | null>(null);
  const [removedRecipients, setRemovedRecipients] = useState<Set<string>>(new Set());
  const [reviewDraft, setReviewDraft] = useState<InsightCandidate | null>(null);
  const [receiptFor, setReceiptFor] = useState<InsightCandidate | null>(null);
  const rankedInsights = useMemo(() => rankInsights(sampleData.insights.candidates), []);
  const money = (amount: number) => `${currencyPrefix}${Math.abs(amount).toLocaleString(currentLocale)}`;

  // Deliberately not a useEffect: this reacts to a prop change by opening
  // local state, so it's applied during render (React's documented pattern
  // for "adjusting state when a prop changes") rather than after commit.
  const [handledTargetToken, setHandledTargetToken] = useState(0);
  if (pendingTarget && targetToken !== handledTargetToken) {
    setHandledTargetToken(targetToken);
    if (pendingTarget.kind === "reviewDraft" || pendingTarget.kind === "reminderReceipt") {
      const insight = sampleData.insights.candidates.find((candidate) => candidate.id === pendingTarget.insightId);
      if (insight) {
        if (pendingTarget.kind === "reminderReceipt") setReceiptFor(insight);
        else setReviewDraft(insight);
      }
    } else if (pendingTarget.kind === "history") {
      setHistoryOpen(true);
    }
  }

  const insightActionLabel = (insight: InsightCandidate) => {
    if (!insight.action) return "";
    switch (insight.action.type) {
      case "sendReminders": return t("Overview.actionSendReminders", { count: insight.action.recipients.length });
      case "escalateMaintenance": return t("Overview.actionEscalateMaintenance");
      case "draftPricingReview": return t("Overview.actionDraftPricingReview");
      case "openReview": return t("Overview.actionOpenReview");
    }
  };

  // The single entry point for opening any insight, whatever its status:
  // a pending reminder batch opens the compose flow, an already-sent batch
  // opens its read-only receipt, and everything else opens the draft dialog
  // (which shows Approve/Deny while pending, or a status badge once decided).
  const openInsight = (insight: InsightCandidate) => {
    const status = reviewStatuses[insight.id];
    if (status === "sent") { setReceiptFor(insight); return; }
    if (status === "pending" && insight.action?.type === "sendReminders") { setRemovedRecipients(new Set()); setReminderPreview(insight); return; }
    setReviewDraft(insight);
  };

  return <div className="view-wrap">
    <AppHeader
      title={t("Overview.portfolioOverview")}
      subtitle={dataMode === "live"
        ? t("Overview.aCalmLiveReadOnLeasing")
        : t("Overview.aCalmReadOnLeasingCash")}
      actions={<>
        {showChip && <span className="sample-chip">{t("Overview.sampleDataConnectASourceTo")}<button aria-label={t("Overview.dismiss")} onClick={() => setChipDismissed(true)}><Xmark width={12} height={12}/></button></span>}
        <DateRangePicker period={period} onChange={setPeriod} t={t} locale={currentLocale}/>
        <button className="primary-button" onClick={openConnections}><NetworkLeft width={18} height={18}/>{t("Overview.connectData")}</button>
      </>}
    />

    {isSample && <section className="overview-intro" data-reveal>
      <div><span className="presence-dot"/>{t("Overview.updatedMinutesAgo", { minutes: sampleData.updatedMinutesAgo })}</div>
      <p>{t("Overview.unitsAcrossProperties", { units: sampleData.portfolio.units, properties: sampleData.portfolio.properties })}</p>
    </section>}

    <section className="metric-grid">{metricTiles.map((metric) => { const connected = !isSample && isTileConnected(metric.key); return <article className={`metric-card${isSample ? "" : " is-empty"}`} data-reveal data-sound-reveal key={metric.key}>
      <div className="metric-top"><span>{t(metric.labelKey)}</span><StatsUpSquare width={18} height={18}/></div>
      {isSample
        ? <>
            <strong><AnimatedNumber value={metric.value} prefix={metric.prefix === "$" ? currencyPrefix : metric.prefix} suffix={metric.suffix} decimals={metric.decimals}/></strong>
            <div className="metric-meta"><span>{metric.deltaText}</span> {t(metric.detailKey, metric.detailParams)}</div>
            <div className="mini-bars" aria-hidden="true">{metric.bars.map((height, index) => <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${index * 65}ms` } as React.CSSProperties}/>)}</div>
            <button className="metric-drilldown-trigger" onClick={() => setDrillDown(metric.key)}>{t("Overview.viewEvidence")}<NavArrowRight width={13} height={13}/></button>
          </>
        : connected
        ? <>
            <div className="empty-spark" aria-hidden="true"/>
            <p className="empty-copy"><span className="presence-dot"/> {t("Overview.connectedAwaitingFirstSync")}</p>
          </>
        : <>
            <div className="empty-spark" aria-hidden="true"/>
            <p className="empty-copy">{t(metric.emptyDescriptionKey)}</p>
            <button className="text-button" onClick={openConnections}>{t("Overview.connect")}<NavArrowRight width={14} height={14}/></button>
          </>}
    </article>; })}</section>

    <section className="panel insights-panel" data-reveal>
      <div className="panel-heading"><div><p className="eyebrow">{t("Overview.insightsEyebrow")}</p><h2>{t("Overview.insightsHeading")}</h2></div><Flash width={20} height={20}/></div>
      {isSample
        ? <div className="insight-list">{rankedInsights.map((insight, index) => <article className="insight-card" key={insight.id}>
            <span className="insight-rank">{index + 1}</span>
            <div className="insight-body">
              <h3>{t(insight.titleKey)}</h3>
              <p>{t(insight.detailKey)}</p>
              <div className="insight-meta">
                <span className="insight-stake"><Coins width={14} height={14}/>{t("Overview.moneyAtStake")}<b>{money(insight.moneyAtStake)}</b></span>
                {insight.tileKey && <button className="text-button" onClick={() => setDrillDown(insight.tileKey)}>{t("Overview.viewEvidence")}<NavArrowRight width={14} height={14}/></button>}
              </div>
            </div>
            <button className="insight-action" onClick={() => openInsight(insight)}>
              {(() => {
                const status = reviewStatuses[insight.id];
                if (status === "denied") return <><XmarkCircle width={16} height={16}/>{t("Overview.deniedBadge")}</>;
                if (status === "sent") return <><CheckCircle width={16} height={16}/>{t("Overview.remindersSentBadge")}</>;
                if (status === "approved") return <><CheckCircle width={16} height={16}/>{t("Overview.approvedBadge")}</>;
                return insightActionLabel(insight);
              })()}
            </button>
          </article>)}</div>
        : <p className="empty-copy">{t("Overview.insightsEmptyDescription")}</p>}
    </section>

    <Dialog.Root open={drillDown !== null} onOpenChange={(open) => !open && setDrillDown(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="small-dialog evidence-dialog">
          {drillDown && <>
            <div className="dialog-top"><Dialog.Title>{t(metricTiles.find((metric) => metric.key === drillDown)!.labelKey)}</Dialog.Title><Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close></div>
            {drillDown === "noi"
              ? <NoiWaterfall t={t} money={money}/>
              : <div className="evidence-rows">{(drillDown === "economicOccupancy" ? sampleData.economicOccupancy.evidenceRows : drillDown === "rentCollected" ? sampleData.rentCollected.evidenceRows : sampleData.openWorkOrders.evidenceRows).map((row) => <div className="evidence-row" key={row.labelKey}><div><strong>{t(row.labelKey)}</strong><small>{t(row.detailKey)}</small></div><span>{money(row.amount)}</span></div>)}</div>}
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <ReminderPreviewDialog
      insight={reminderPreview}
      removedRecipients={removedRecipients}
      onRemoveRecipient={(name) => setRemovedRecipients((current) => new Set(current).add(name))}
      onOpenChange={(open) => !open && setReminderPreview(null)}
      onSend={(recipients) => { onSendReminders(reminderPreview!, recipients); setReminderPreview(null); }}
      onDeny={() => { onDeny(reminderPreview!); setReminderPreview(null); }}
      t={t} money={money}
    />

    <ReviewDraftDialog
      insight={reviewDraft}
      status={reviewDraft ? reviewStatuses[reviewDraft.id] : undefined}
      expanded={draftExpanded}
      onToggleExpand={() => setDraftExpanded((current) => !current)}
      onOpenChange={(open) => { if (!open) { setReviewDraft(null); setDraftExpanded(false); } }}
      onApprove={() => { onApprove(reviewDraft!); setReviewDraft(null); }}
      onDeny={() => { onDeny(reviewDraft!); setReviewDraft(null); }}
      t={t} money={money}
    />

    <ReviewReceiptDialog
      insight={receiptFor}
      recipients={receiptFor ? sentReceipts[receiptFor.id] ?? [] : []}
      onOpenChange={(open) => !open && setReceiptFor(null)}
      t={t} money={money}
    />

    <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay subtle"/>
        <Dialog.Content className="notification-drawer">
          <div className="drawer-heading">
            <div><p className="eyebrow">{t("Overview.historyCount", { count: sampleData.history.entries.length })}</p><Dialog.Title>{t("Overview.historyTitle")}</Dialog.Title></div>
            <Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close>
          </div>
          <div className="notification-list history-list">
            {sampleData.history.entries.map((entry) => (
              <div className="history-row" key={entry.id}>
                <BrandMark provider={entry.provider} small/>
                <span><strong>{t(entry.textKey)}</strong><small>{formatMinutesAgo(entry.minutesAgo, currentLocale)}</small></span>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <section className="overview-grid" data-reveal>
      <article className="panel funnel-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("Overview.leasing")}</p><h2>{t("Overview.leadToLeaseFunnel")}</h2></div><span className="quiet-label">{period}</span></div>
        {isSample
          ? <>
              <div className="funnel-stage-labels">{funnelStages.map((stage) => <div key={stage.key}><strong><AnimatedNumber value={stage.count}/></strong><span>{t(stage.labelKey)}</span></div>)}</div>
              <div className="funnel-graphic">{funnelStages.map((stage, index) => <div className="funnel-band" style={{ "--band-width": stage.width, "--band-delay": `${index * 110}ms` } as React.CSSProperties} key={stage.key}/>)}</div>
              <div className="funnel-footer">
                <span><strong>{derivedSample.contactedToViewedPct.toFixed(1)}%</strong> {t("Overview.contactedViewed")}</span>
                <span><strong>{derivedSample.contactedToSignedPct.toFixed(1)}%</strong> {t("Overview.contactedSigned")}</span>
                <button className="text-button" onClick={openConnections}>{t("Overview.configureSource")}<NavArrowRight width={16} height={16}/></button>
              </div>
            </>
          : isTileConnected("funnel")
          ? <>
              <div className="funnel-stage-labels">{funnelStages.map((stage) => <div key={stage.key}><div className="empty-spark" aria-hidden="true"/><span>{t(stage.labelKey)}</span></div>)}</div>
              <p className="empty-copy"><span className="presence-dot"/> {t("Overview.connectedAwaitingFirstSync")}</p>
            </>
          : <>
              <div className="funnel-stage-labels">{funnelStages.map((stage) => <div key={stage.key}><div className="empty-spark" aria-hidden="true"/><span>{t(stage.labelKey)}</span></div>)}</div>
              <p className="empty-copy">{t("Overview.contactedViewedAppliedAndSignedCounts")}</p>
              <button className="text-button" onClick={openConnections}>{t("Overview.configureSource")}<NavArrowRight width={16} height={16}/></button>
            </>}
      </article>
      <article className="panel coverage-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("Overview.dataCoverage")}</p><h2>{t("Overview.connectedCount", { connected: connectedCount, total: sampleData.coverage.rows.length })}</h2></div><ShieldCheck width={22} height={22}/></div>
        {sampleData.coverage.rows.map((row) => { const rowConnected = isCoverageRowConnected(row); return <div className="source-row" key={row.provider}><BrandMark provider={resolveCoverageProvider(row)} small/><div><strong>{t(row.labelKey)}</strong><span>{row.provider === "quickbooks" && market === "latam" ? t("Overview.coverageAccountingDetailLatam") : t(row.detailKey)}</span></div><span className={`status-pill ${rowConnected ? "" : "optional"}`}>{rowConnected ? t("Overview.connected") : row.required ? t("Overview.required") : t("Overview.optional")}</span></div>; })}
        <button className="wide-button" onClick={openConnections}>{t("Overview.openConnections")}<NavArrowRight width={17} height={17}/></button>
      </article>
    </section>

    <section className="panel activity-panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">Aval, now</p><h2>{t("Overview.workMovingThroughTheSystem")}</h2></div>
        {isSample && <button className="soft-button" onClick={() => setHistoryOpen(true)}><Archive width={17} height={17}/>{t("Overview.history")}</button>}
      </div>
      {isSample
        ? <div className="activity-flow">{sampleData.ledger.steps.map((step, index) => <span className="activity-segment" key={step.provider}>{index > 0 && <i className="flow-arrow">→</i>}<span className={`activity-card ${step.provider === "complete" ? "complete" : ""}`}><span>{step.provider === "complete" ? <CheckCircle width={24} height={24}/> : <BrandMark provider={step.provider} small/>}</span><p>{t(step.textKey)}</p></span></span>)}</div>
        : <p className="empty-copy">{t("Overview.noVerifiedActionsYetAvalWill")}</p>}
    </section>
  </div>;
}

const REVIEW_STATUS_ORDER: ReviewStatus[] = ["pending", "approved", "sent", "denied"];

/**
 * Every drafted review and reminder batch in one place — pending, approved,
 * sent, or denied — with the same drafts, evidence, recipients, and sent
 * messages the Overview queue shows, just uncapped and filterable instead
 * of limited to the top 5 by money × urgency.
 */
function ReviewCenterView({ reviewStatuses, sentReceipts, onApprove, onDeny, onSendReminders }: {
  reviewStatuses: Record<string, ReviewStatus>; sentReceipts: Record<string, InsightRecipient[]>;
  onApprove: (insight: InsightCandidate) => void; onDeny: (insight: InsightCandidate) => void;
  onSendReminders: (insight: InsightCandidate, recipients: InsightRecipient[]) => void;
}) {
  const { market } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const currencyPrefix = market === "latam" ? "MX$" : "$";
  const money = (amount: number) => `${currencyPrefix}${Math.abs(amount).toLocaleString(currentLocale)}`;
  const [activeFilter, setActiveFilter] = useState<"all" | ReviewStatus>("all");
  const [draftExpanded, setDraftExpanded] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<InsightCandidate | null>(null);
  const [receiptFor, setReceiptFor] = useState<InsightCandidate | null>(null);
  const [reminderPreview, setReminderPreview] = useState<InsightCandidate | null>(null);
  const [removedRecipients, setRemovedRecipients] = useState<Set<string>>(new Set());

  const allReviewable = sampleData.insights.candidates.filter((candidate) => candidate.actionable && candidate.action !== null);
  const statusCounts = REVIEW_STATUS_ORDER.reduce((counts, status) => ({ ...counts, [status]: allReviewable.filter((insight) => reviewStatuses[insight.id] === status).length }), {} as Record<ReviewStatus, number>);
  const sorted = [...allReviewable].sort((a, b) => {
    const aPending = reviewStatuses[a.id] === "pending";
    const bPending = reviewStatuses[b.id] === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    return b.moneyAtStake * b.urgency - a.moneyAtStake * a.urgency;
  });
  const visible = activeFilter === "all" ? sorted : sorted.filter((insight) => reviewStatuses[insight.id] === activeFilter);

  const openInsight = (insight: InsightCandidate) => {
    const status = reviewStatuses[insight.id];
    if (status === "sent") { setReceiptFor(insight); return; }
    if (status === "pending" && insight.action?.type === "sendReminders") { setRemovedRecipients(new Set()); setReminderPreview(insight); return; }
    setReviewDraft(insight);
  };

  return <div className="view-wrap">
    <AppHeader title={t("Nav.reviewCenter")} subtitle={t("ReviewCenter.subtitle")}/>

    <section className="metric-grid compact-metrics" data-reveal>
      {REVIEW_STATUS_ORDER.map((status) => <article className="metric-card" key={status}>
        <span>{t(REVIEW_STATUS_LABEL_KEY[status])}</span>
        <strong><AnimatedNumber value={statusCounts[status]}/></strong>
      </article>)}
    </section>

    <div className="segmented text review-filter" data-reveal>
      <button className={activeFilter === "all" ? "active" : ""} onClick={() => setActiveFilter("all")}>{t("ReviewCenter.filterAll", { count: allReviewable.length })}</button>
      {REVIEW_STATUS_ORDER.map((status) => <button className={activeFilter === status ? "active" : ""} onClick={() => setActiveFilter(status)} key={status}>{t(REVIEW_STATUS_LABEL_KEY[status])} · {statusCounts[status]}</button>)}
    </div>

    <section className="panel review-list-panel" data-reveal>
      {visible.length === 0
        ? <p className="empty-copy">{t("ReviewCenter.emptyFilter")}</p>
        : <div className="review-list">{visible.map((insight) => {
            const status = reviewStatuses[insight.id];
            const StatusIcon = REVIEW_STATUS_ICON[status];
            const sentCount = status === "sent" && insight.action?.type === "sendReminders" ? (sentReceipts[insight.id] ?? insight.action.recipients).length : null;
            return <article className="review-row" key={insight.id}>
              <span className={`review-status-icon status-${status}`}><StatusIcon width={18} height={18}/></span>
              <div className="review-row-body">
                <div className="review-row-top"><h3>{t(insight.titleKey)}</h3><span className="review-status-label">{t(REVIEW_STATUS_LABEL_KEY[status])}</span></div>
                <p>{t(insight.detailKey)}</p>
                <div className="review-row-meta">
                  <span className="insight-stake"><Coins width={13} height={13}/>{t("Overview.moneyAtStake")}<b>{money(insight.moneyAtStake)}</b></span>
                  {sentCount !== null && <span>{t("ReviewCenter.sentToCount", { count: sentCount })}</span>}
                </div>
              </div>
              <button className="soft-button" onClick={() => openInsight(insight)}>{t("ReviewCenter.viewDetails")}<NavArrowRight width={16} height={16}/></button>
            </article>;
          })}</div>}
    </section>

    <ReminderPreviewDialog
      insight={reminderPreview}
      removedRecipients={removedRecipients}
      onRemoveRecipient={(name) => setRemovedRecipients((current) => new Set(current).add(name))}
      onOpenChange={(open) => !open && setReminderPreview(null)}
      onSend={(recipients) => { onSendReminders(reminderPreview!, recipients); setReminderPreview(null); }}
      onDeny={() => { onDeny(reminderPreview!); setReminderPreview(null); }}
      t={t} money={money}
    />

    <ReviewDraftDialog
      insight={reviewDraft}
      status={reviewDraft ? reviewStatuses[reviewDraft.id] : undefined}
      expanded={draftExpanded}
      onToggleExpand={() => setDraftExpanded((current) => !current)}
      onOpenChange={(open) => { if (!open) { setReviewDraft(null); setDraftExpanded(false); } }}
      onApprove={() => { onApprove(reviewDraft!); setReviewDraft(null); }}
      onDeny={() => { onDeny(reviewDraft!); setReviewDraft(null); }}
      t={t} money={money}
    />

    <ReviewReceiptDialog
      insight={receiptFor}
      recipients={receiptFor ? sentReceipts[receiptFor.id] ?? [] : []}
      onOpenChange={(open) => !open && setReceiptFor(null)}
      t={t} money={money}
    />
  </div>;
}

type Task = { id: number; status: string; title: string; detail: string; provider: string; time: string; action: string };
const initialTasks: Task[] = [
  { id: 1, status: "needs", title: "Approve payment-plan response", detail: "Diana Ortiz · 12 days past due", provider: "whatsapp", time: "9 min", action: "Review draft" },
  { id: 2, status: "progress", title: "Book a viewing for tomorrow at 3pm", detail: "Marcus Lee · Franklin House 4B", provider: "apple_messages", time: "18 min", action: "In progress" },
  { id: 3, status: "progress", title: "Reconcile three unmatched deposits", detail: "August operating account", provider: "quickbooks", time: "26 min", action: "In progress" },
  { id: 4, status: "parked", title: "Wait for vendor estimate", detail: "Boiler repair · Union Court", provider: "outlook", time: "1 hr", action: "Waiting" },
  { id: 5, status: "done", title: "Lease signed and filed", detail: "AppFolio · Franklin House 4B", provider: "appfolio", time: "Today", action: "Complete" },
];
const columns = [{ id: "needs", labelKey: "TasksView.needsYou", icon: User }, { id: "progress", labelKey: "TasksView.inProgress", icon: Clock }, { id: "parked", labelKey: "TasksView.parked", icon: Pause }, { id: "done", labelKey: "TasksView.done", icon: CheckCircle }];
function TasksView({ draftJobs, onCreateDraft, onPauseDraft, onResumeDraft, onRetryDraft, onSendDraft }: {
  draftJobs: DraftJob[]; onCreateDraft: (input: CreateDraftInput) => void; onPauseDraft: (id: string) => void; onResumeDraft: (id: string) => void; onRetryDraft: (id: string) => void; onSendDraft: (id: string, recipient: string) => void;
}) {
  const { notify, celebrate } = useExperience();
  const t = useTranslations(); const [layout, setLayout] = useState<"board" | "list">("board"); const [query, setQuery] = useState(""); const [filter, setFilter] = useState("all"); const [items, setItems] = useState(initialTasks); const [editing, setEditing] = useState<Task | null>(null); const [creating, setCreating] = useState(false); const [draft, setDraft] = useState("");
  const visible = items.filter((task) => (filter === "all" || task.status === filter) && `${task.title} ${task.detail}`.toLowerCase().includes(query.toLowerCase()));
  const saveTask = (event: FormEvent) => { event.preventDefault(); if (!draft.trim()) return; setItems((current) => [{ id: Date.now(), status: "needs", title: draft.trim(), detail: "Created by Camila · just now", provider: "slack", time: "Now", action: "Review" }, ...current]); notify(t("TasksView.taskCreated"), draft); setDraft(""); setCreating(false); };
  const complete = (task: Task) => { setItems((current) => current.map((item) => item.id === task.id ? { ...item, status: "done", action: "Complete", time: "Now" } : item)); setEditing(null); celebrate(t("TasksView.taskComplete"), task.title); };
  return <div className="view-wrap task-view"><AppHeader title={t("TasksView.tasks")} subtitle={t("TasksView.everythingAvalIsDoingWaitingOn")} actions={<><div className="segmented compact"><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} aria-label={t("TasksView.listLayout")}><ViewColumns3 width={18} height={18}/></button><button className={layout === "board" ? "active" : ""} onClick={() => setLayout("board")} aria-label={t("TasksView.boardLayout")}><ViewGrid width={18} height={18}/></button></div><button className="primary-button" onClick={() => setCreating(true)}><Plus width={18} height={18}/>{t("TasksView.newTask")}</button></>}/><AskAvalTasksSection jobs={draftJobs} onCreate={onCreateDraft} onPause={onPauseDraft} onResume={onResumeDraft} onRetry={onRetryDraft} onSend={onSendDraft}/><div className="task-toolbar"><label className="search-field"><Search width={19} height={19}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("TasksView.searchTasks")}/></label><details className="app-menu"><summary className="soft-button"><FilterList width={17} height={17}/>{t("TasksView.filters")}<NavArrowDown width={15} height={15}/></summary><div className="menu-popover">{[{ id: "all", label: t("TasksView.allTasks") }, ...columns.map((column) => ({ id: column.id, label: t(column.labelKey) }))].map((option) => <button key={option.id} onClick={() => setFilter(option.id)}><Check className={filter === option.id ? "visible-check" : "hidden-check"} width={15} height={15}/>{option.label}</button>)}</div></details></div><div className={`task-board ${layout}`}>{columns.map((column) => { const Icon = column.icon; const columnTasks = visible.filter((task) => task.status === column.id); return <section className="task-column" data-reveal key={column.id}><div className="column-heading"><span><Icon width={20} height={20}/>{t(column.labelKey)}</span><b>{columnTasks.length}</b></div><div className="column-list">{columnTasks.length ? columnTasks.map((task) => <article className="task-card" key={task.id}><div className="task-card-top"><BrandMark provider={task.provider} small/><span>{task.time}</span></div><h3>{task.title}</h3><p>{task.detail}</p><div className="task-card-bottom"><span>{task.action}</span><button onClick={() => setEditing(task)} aria-label={t("TasksView.openTask")}><NavArrowRight width={17} height={17}/></button></div></article>) : <div className="empty-column">{t("TasksView.nothingHere")}</div>}</div></section>; })}</div><Dialog.Root open={creating} onOpenChange={setCreating}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="small-dialog"><Dialog.Title>{t("TasksView.createTask")}</Dialog.Title><form onSubmit={saveTask}><label>{t("TasksView.whatNeedsToHappen")}<textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("TasksView.describeTheOutcome")}/></label><div className="dialog-actions"><Dialog.Close className="soft-button">{t("TasksView.cancel")}</Dialog.Close><button className="primary-button" type="submit">{t("TasksView.createTask")}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root><Dialog.Root open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="small-dialog">{editing && <><div className="dialog-top"><BrandMark provider={editing.provider}/><Dialog.Close className="icon-button"><Xmark width={20} height={20}/></Dialog.Close></div><Dialog.Title>{editing.title}</Dialog.Title><Dialog.Description>{editing.detail}</Dialog.Description><div className="task-detail-meta"><span>{editing.time}</span><span>{editing.action}</span></div><div className="dialog-actions"><button className="soft-button" onClick={() => { notify(t("TasksView.taskParked")); setEditing(null); }}>{t("TasksView.park")}</button><button className="primary-button" onClick={() => complete(editing)}><Check width={17} height={17}/>{t("TasksView.markComplete")}</button></div></>}</Dialog.Content></Dialog.Portal></Dialog.Root></div>;
}

const inboxItems = [
  { name: "Marcus Lee", unit: "Franklin House · 4B", text: "Tomorrow at three works perfectly.", provider: "apple_messages", time: "2m", unread: 2 },
  { name: "Diana Ortiz", unit: "Monroe Court · 2A", text: "Could we split this month's balance?", provider: "whatsapp", time: "11m", unread: 1 },
  { name: "Alvarez Plumbing", unit: "Vendor · Maintenance", text: "Estimate attached for the boiler.", provider: "outlook", time: "24m", unread: 0 },
  { name: "Portfolio team", unit: "Slack · #operations", text: "Approved. Go ahead and send it.", provider: "slack", time: "41m", unread: 0 },
];
function InboxView({ pendingTarget, targetToken }: { pendingTarget: NotificationTarget | null; targetToken: number }) {
  const { notify } = useExperience();
  const t = useTranslations(); const [active, setActive] = useState(0); const current = inboxItems[active]; const [reply, setReply] = useState(""); const [sent, setSent] = useState<string[]>([]); const input = useRef<HTMLInputElement>(null); const file = useRef<HTMLInputElement>(null);
  // Deliberately not a useEffect — see the matching comment in Overview.
  const [handledTargetToken, setHandledTargetToken] = useState(0);
  if (pendingTarget && pendingTarget.kind === "inboxThread" && targetToken !== handledTargetToken) {
    setHandledTargetToken(targetToken);
    const index = inboxItems.findIndex((item) => item.name === pendingTarget.contactName);
    if (index >= 0) { setActive(index); setSent([]); }
  }
  const send = () => { if (!reply.trim()) return; setSent((messages) => [...messages, reply.trim()]); setReply(""); notify(t("InboxView.messageSent"), `${t("InboxView.via")} ${current.provider.replace("_", " ")}`); };
  return <div className="view-wrap"><AppHeader title={t("InboxView.sharedInbox")} subtitle={t("InboxView.oneResidentTimelineAcrossEveryConnected")} actions={<button className="primary-button" onClick={() => input.current?.focus()}><Plus width={18} height={18}/>{t("InboxView.newMessage")}</button>}/><div className="inbox-window" data-reveal><aside className="conversation-list"><label className="search-field"><Search width={18} height={18}/><input placeholder={t("InboxView.searchConversations")}/></label>{inboxItems.map((item, index) => <button className={`conversation-row ${active === index ? "active" : ""}`} onClick={() => { setActive(index); setSent([]); }} key={item.name}><BrandMark provider={item.provider} small/><span><strong>{item.name}</strong><small>{item.unit}</small><em>{item.text}</em></span><i>{item.time}</i>{item.unread > 0 && <b>{item.unread}</b>}</button>)}</aside><section className="message-thread"><header><div><BrandMark provider={current.provider} small/><div><strong>{current.name}</strong><span>{current.unit}</span></div></div><button className="icon-button" onClick={() => notify(t("InboxView.calling"), `${current.name} · Twilio`)} aria-label={t("InboxView.call")}><Phone width={20} height={20}/></button></header><div className="message-canvas"><div className="date-divider">{t("InboxView.today")}</div><div className="message received"><p>{t("InboxView.mockQuestionAboutNextStep")}</p><span>14:18</span></div><div className="message sent"><p>{t("InboxView.mockViewingHeld")}</p><span>14:19 · {t("InboxView.mockDraftApproved")}</span></div><div className="message received"><p>{current.text}</p><span>14:21</span></div>{sent.map((message, index) => <div className="message sent" key={`${message}-${index}`}><p>{message}</p><span>{t("InboxView.nowDelivered")}</span></div>)}</div><footer className="composer"><input ref={file} type="file" hidden onChange={() => notify(t("InboxView.attachmentReady"), file.current?.files?.[0]?.name)}/><button className="icon-button" onClick={() => file.current?.click()} aria-label={t("InboxView.attach")}><Attachment width={19} height={19}/></button><input ref={input} value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={t("InboxView.writeAReplyOrAskAval")}/><button className="primary-button" onClick={send}><SendDiagonal width={17} height={17}/>{t("InboxView.send")}</button></footer></section><aside className="contact-panel"><p className="eyebrow">{t("InboxView.residentContext")}</p><div className="profile-block"><span className="initials">{current.name.split(" ").map((part) => part[0]).join("")}</span><h3>{current.name}</h3><p>{current.unit}</p></div><dl><div><dt>{t("InboxView.stage")}</dt><dd>{t("InboxView.viewingBooked")}</dd></div><div><dt>{t("InboxView.source")}</dt><dd>{current.provider.replace("_", " ")}</dd></div><div><dt>{t("InboxView.owner")}</dt><dd>{t("InboxView.leasingTeam")}</dd></div></dl><button className="wide-button" onClick={() => notify(t("InboxView.residentRecordOpened"), current.name)}>{t("InboxView.openResidentRecord")}<NavArrowRight width={17} height={17}/></button></aside></div></div>;
}

function SourceCard({ provider, title, detail, onOpen }: { provider: string; title: string; detail: string; onOpen: (provider: string) => void }) { const t = useTranslations(); return <article className="required-source" data-reveal><BrandMark provider={provider}/><div><p className="eyebrow">{t("SourceCard.requiredUpstreamSystem")}</p><h3>{title}</h3><p>{detail}</p><div className="scope-row"><span><ShieldCheck width={15} height={15}/>{t("SourceCard.readAccessOnly")}</span><span><Database width={15} height={15}/>{t("SourceCard.historicalSync")}</span></div></div><button className="primary-button" onClick={() => onOpen(provider)}>{t("SourceCard.connect")}<NavArrowRight width={17} height={17}/></button></article>; }
function ConnectionsView({ providers, loading, onOpen }: { providers: Provider[]; loading: boolean; onOpen: (id: string) => void }) {
  const { market, notify } = useExperience();
  const t = useTranslations(); const apps = providerOrder.map((id) => providers.find((provider) => provider.id === id)).filter(Boolean) as Provider[];
  const pmsApps = pmsProviderOrder.map((id) => providers.find((provider) => provider.id === id)).filter(Boolean) as Provider[];
  const accountingProvider = market === "latam" ? "contpaqi" : "quickbooks";
  const accountingDetail = market === "latam" ? "CONTPAQi, Alegra, or Xero for receivables, payments, occupancy economics, and delinquency." : "QuickBooks, Xero, or the PMS accounting module for receivables, payments, occupancy economics, and delinquency.";
  const [pipelineDetail, setPipelineDetail] = useState<string | null>(null);
  const activeStage = PIPELINE_STAGES.find((stage) => stage.id === pipelineDetail) ?? null;
  return <div className="view-wrap connections-view"><AppHeader title={t("ConnectionsView.connections")} subtitle={t("ConnectionsView.aSecureExplicitBridgeToThe")} actions={<button className="soft-button" onClick={() => notify(t("ConnectionsView.securityModel"), t("ConnectionsView.tenantIsolatedCredentialsLeastPrivilegeSigned"))}><ShieldCheck width={18} height={18}/>{t("ConnectionsView.securityModel")}</button>}/><section className="connection-hero" data-reveal data-sound-reveal><div><p className="eyebrow">{t("ConnectionsView.connectionLayer")}</p><h2>{t("ConnectionsView.bringTheOperatingSystemTogether")}</h2><p>{t("ConnectionsView.authorizeOnlyWhatAvalNeedsEvery")}</p></div><div className="pipeline-diagram">{PIPELINE_STAGES.flatMap((stage, index) => { const Icon = stage.icon; const node = <button type="button" className="pipeline-node" style={{ "--node-delay": `${index * 120}ms` } as React.CSSProperties} onClick={() => setPipelineDetail(stage.id)} key={`node-${stage.id}`}><Icon width={18} height={18}/>{t(stage.labelKey)}</button>; return index === 0 ? [node] : [<i key={`line-${stage.id}`}/>, node]; })}</div></section>

    <Dialog.Root open={activeStage !== null} onOpenChange={(open) => !open && setPipelineDetail(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="small-dialog">
          {activeStage && <>
            <div className="dialog-top"><Dialog.Title>{t(activeStage.labelKey)}</Dialog.Title><Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close></div>
            <p className="pipeline-detail-text">{t(activeStage.detailKey)}</p>
            <div className="dialog-actions"><Dialog.Close className="soft-button">{t("Overview.close")}</Dialog.Close></div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <section><div className="section-title"><div><p className="eyebrow">{t("ConnectionsView.foundation")}</p><h2>{t("ConnectionsView.connectTwoUpstreamSystems")}</h2></div><p>{t("ConnectionsView.metricsAndTheLeasingFunnelUnlock")}</p></div><div className="required-grid"><SourceCard provider={accountingProvider} title={t("ConnectionsView.accountingSystem")} detail={accountingDetail} onOpen={onOpen}/><SourceCard provider="appfolio" title={t("ConnectionsView.leasingPipeline")} detail="AppFolio, Buildium, or the PMS source for contacted → viewed → applied → signed." onOpen={onOpen}/></div></section>

    <section><div className="section-title"><div><p className="eyebrow">{t("ConnectionsView.propertySystems")}</p><h2>{t("ConnectionsView.propertySystemsHeading")}</h2></div><p>{t("ConnectionsView.propertySystemsBody")}</p></div><div className="connection-grid">{pmsApps.map((provider) => <article className="connection-card" data-reveal key={provider.id}><div className="connection-card-top"><BrandMark provider={provider.id}/><span className={`connection-status ${provider.connection?.status ?? "not-connected"}`}>{provider.connection?.status?.replaceAll("_", " ") ?? (provider.configured ? t("ConnectionsView.readyToConfigure") : t("ConnectionsView.avalSetupRequired"))}</span></div><h3>{provider.title}</h3><p>{provider.description}</p><div className="connection-features"><span>{provider.readOnly ? t("ConnectionsView.readOnly") : t("ConnectionsView.twoWay")}</span><span>{provider.webhook ? "Webhook" : t("ConnectionsView.scheduledSync")}</span></div><button className="wide-button" onClick={() => onOpen(provider.id)}>{provider.connection?.status === "connected" ? t("ConnectionsView.manage") : t("ConnectionsView.setUp")}<NavArrowRight width={17} height={17}/></button></article>)}</div></section>

    <section><div className="section-title"><div><p className="eyebrow">{t("ConnectionsView.channelsContext")}</p><h2>{t("ConnectionsView.meetAvalWhereTheWorkHappens")}</h2></div><p>{loading ? t("ConnectionsView.checkingYourWorkspace") : t("ConnectionsView.permissionsStayIsolatedPerConnection")}</p></div><div className="connection-grid">{apps.map((provider) => <article className="connection-card" data-reveal key={provider.id}><div className="connection-card-top"><BrandMark provider={provider.id}/><span className={`connection-status ${provider.connection?.status ?? "not-connected"}`}>{provider.connection?.status?.replaceAll("_", " ") ?? (provider.configured ? t("ConnectionsView.readyToConfigure") : t("ConnectionsView.avalSetupRequired"))}</span></div><h3>{provider.title}</h3><p>{provider.description}</p><div className="connection-features"><span>{provider.readOnly ? t("ConnectionsView.readOnly") : t("ConnectionsView.twoWay")}</span><span>{provider.webhook ? "Webhook" : t("ConnectionsView.scheduledSync")}</span></div><button className="wide-button" onClick={() => onOpen(provider.id)}>{provider.connection?.status === "connected" ? t("ConnectionsView.manage") : t("ConnectionsView.setUp")}<NavArrowRight width={17} height={17}/></button></article>)}</div></section></div>;
}

const propertyTotals = derivePropertyTotals(sampleData.properties.list);
const maintenanceReported = deriveMaintenanceReported(sampleData.maintenance.categories);

const operationCopy: Record<string, { titleKey: string; subtitleKey: string; metrics: { labelKey: string; value: number; prefix?: string; suffix?: string; decimals?: number }[] }> = {
  properties: { titleKey: "Nav.properties", subtitleKey: "OperationsView.propertiesSubtitle", metrics: [{ labelKey: "Nav.properties", value: propertyTotals.properties }, { labelKey: "OperationsView.unitsCount", value: propertyTotals.units }, { labelKey: "OperationsView.occupiedCount", value: propertyTotals.occupied }, { labelKey: "OperationsView.readyForLeasingCount", value: propertyTotals.readyForLeasing }] },
  leasing: { titleKey: "Nav.leasing", subtitleKey: "OperationsView.leasingSubtitle", metrics: funnelStages.map((stage) => ({ labelKey: stage.labelKey, value: stage.count })) },
  maintenance: { titleKey: "Nav.maintenance", subtitleKey: "OperationsView.maintenanceSubtitle", metrics: [{ labelKey: "OperationsView.reportedCount", value: maintenanceReported }, { labelKey: "OperationsView.assignedCount", value: sampleData.maintenance.assigned }, { labelKey: "OperationsView.workDoneCount", value: sampleData.maintenance.workDone }, { labelKey: "OperationsView.completedCount", value: sampleData.maintenance.completed }] },
  accounting: { titleKey: "Nav.accounting", subtitleKey: "OperationsView.accountingSubtitle", metrics: [{ labelKey: "OperationsView.rentBilledCount", value: sampleData.rentCollected.billed / 1000, prefix: "$", suffix: "k", decimals: 1 }, { labelKey: "OperationsView.collectedCount", value: sampleData.rentCollected.value / 1000, prefix: "$", suffix: "k", decimals: 1 }, { labelKey: "OperationsView.pastDueCount", value: (sampleData.rentCollected.billed - sampleData.rentCollected.value) / 1000, prefix: "$", suffix: "k", decimals: 1 }, { labelKey: "OperationsView.collectionRateCount", value: derivedSample.rentCollectedPct, suffix: "%", decimals: 1 }] },
  documents: { titleKey: "Nav.documents", subtitleKey: "OperationsView.documentsSubtitle", metrics: [{ labelKey: "OperationsView.filesIndexedCount", value: 284 }, { labelKey: "OperationsView.leaseFilesCount", value: 138 }, { labelKey: "OperationsView.vendorFilesCount", value: 61 }, { labelKey: "OperationsView.needsReviewCount", value: 7 }] },
};
// Which connected provider category unlocks each operations tab's chart.
const OPERATIONS_TILE_SOURCES: Partial<Record<View, string>> = {
  properties: "Leasing & PMS",
  leasing: "Leasing & PMS",
  maintenance: "Leasing & PMS",
  accounting: "Accounting",
};
function OperationsView({ view, openConnections, dataMode, providers }: { view: View; openConnections: () => void; dataMode: DataMode; providers: Provider[] }) {
  const { market } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const currencyPrefix = market === "latam" ? "MX$" : "$";
  const money = (amount: number) => `${currencyPrefix}${Math.round(amount).toLocaleString(currentLocale)}`;
  const data = operationCopy[view];
  const isSample = dataMode === "sample";
  const requiredCategory = OPERATIONS_TILE_SOURCES[view];
  const isConnected = requiredCategory ? providers.some((provider) => provider.category === requiredCategory && provider.connection?.status === "connected") : false;

  return <div className="view-wrap">
    <AppHeader title={t(data.titleKey)} subtitle={t(data.subtitleKey)} actions={<button className="primary-button" onClick={openConnections}><NetworkLeft width={18} height={18}/>{t("OperationsView.connectSource")}</button>}/>
    <section className="metric-grid compact-metrics">{data.metrics.map((metric) => <article className={`metric-card${isSample ? "" : " is-empty"}`} data-reveal key={metric.labelKey}>
      <span>{t(metric.labelKey)}</span>
      {isSample
        ? <strong><AnimatedNumber value={metric.value} prefix={metric.prefix} suffix={metric.suffix} decimals={metric.decimals}/></strong>
        : <div className="empty-spark"/>}
    </article>)}</section>
    {isSample
      ? <section className="panel operations-chart-panel" data-reveal>
          {view === "properties" && <PropertyOccupancyChart t={t} locale={currentLocale}/>}
          {view === "leasing" && <LeasingTrendChart t={t}/>}
          {view === "maintenance" && <MaintenanceRoseChart t={t} locale={currentLocale}/>}
          {view === "accounting" && <AccountingSankey t={t} money={money}/>}
          {view === "documents" && <p className="empty-copy">{t("OperationsView.avalPreservesSourceIdsCursorsAnd")}</p>}
        </section>
      : requiredCategory && isConnected
      ? <section className="panel operations-chart-panel" data-reveal><p className="empty-copy"><span className="presence-dot"/> {t("OperationsView.connectedAwaitingFirstSync")}</p></section>
      : <section className="panel locked-panel" data-reveal><div className="locked-visual"><div className="locking-lines"><i/><i/><i/></div><span><Key width={23} height={23}/></span></div><div><p className="eyebrow">{t("OperationsView.verifiedDataRequired")}</p><h2>{t("OperationsView.connectTheSystemThatOwnsThis")}</h2><p>{t("OperationsView.avalPreservesSourceIdsCursorsAnd")}</p><button className="primary-button" onClick={openConnections}>{t("OperationsView.openConnections")}<NavArrowRight width={17} height={17}/></button></div></section>}
  </div>;
}

function SettingsView({ openConnections, displayName, email }: { openConnections: () => void; displayName: string; email: string }) {
  const initials = displayName.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  const { theme, setTheme, sounds, setSounds, notify } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const switchLocale = (nextLocale: "en" | "es-mx") => router.replace(pathname, { locale: nextLocale });
  return <div className="view-wrap"><AppHeader title={t("SettingsView.settings")} subtitle={t("SettingsView.personalPreferencesStayOnThisDevice")}/><section className="settings-grid"><article className="settings-card" data-reveal><div className="settings-heading"><span className="initials large">{initials}</span><div><p className="eyebrow">{t("SettingsView.profile")}</p><h2>{displayName}</h2><p>{email}</p></div></div><button className="wide-button" onClick={() => notify(t("SettingsView.profileEditorOpened"), t("SettingsView.workspaceIdentityChangesRequireAnAdministrator"))}>{t("SettingsView.editProfile")}<NavArrowRight width={17} height={17}/></button></article><BillingSettings/><article className="settings-card" data-reveal><div className="setting-row"><div><Language width={21} height={21}/><span><strong>{t("SettingsView.language")}</strong><small>{t("SettingsView.englishOrSpanishForLatinAmerica")}</small></span></div><div className="segmented text"><button className={currentLocale === "en" ? "active" : ""} onClick={() => switchLocale("en")}>English</button><button className={currentLocale === "es-mx" ? "active" : ""} onClick={() => switchLocale("es-mx")}>Español (México)</button></div></div><div className="setting-row"><div>{theme === "dark" ? <HalfMoon width={21} height={21}/> : <SunLight width={21} height={21}/>}<span><strong>{t("SettingsView.appearance")}</strong><small>{t("SettingsView.highFidelityLightAndInvertedDark")}</small></span></div><div className="segmented text"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>{t("SettingsView.light")}</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>{t("SettingsView.dark")}</button></div></div><div className="setting-row"><div>{sounds ? <SoundHigh width={21} height={21}/> : <SoundOff width={21} height={21}/>}<span><strong>{t("SettingsView.tactileSounds")}</strong><small>{t("SettingsView.quietTapRevealNotificationAndSuccess")}</small></span></div><button className={`switch ${sounds ? "on" : ""}`} onClick={() => setSounds(!sounds)} aria-pressed={sounds}><i/></button></div></article><article className="settings-card" data-reveal><p className="eyebrow">{t("SettingsView.connectedWorkspace")}</p><h2>{t("SettingsView.permissionsSecurity")}</h2><p>{t("SettingsView.reviewScopesConnectionHealthAndRevocation")}</p><button className="wide-button" onClick={openConnections}>{t("SettingsView.manageConnections")}<NavArrowRight width={17} height={17}/></button></article><article className="settings-card mobile-promo" data-reveal><SmartphoneDevice width={28} height={28}/><div><p className="eyebrow">{t("SettingsView.separateMobileExperience")}</p><h2>Aval Mobile</h2><p>{t("SettingsView.aFocusedInstallableInterfaceForApprovals")}</p></div><Link className="primary-button" href="/mobile">{t("SettingsView.openMobileApp")}<NavArrowRight width={17} height={17}/></Link></article></section></div>;
}

function NoiWaterfall({ t, money }: { t: ReturnType<typeof useTranslations>; money: (amount: number) => string }) {
  const { value, priorValue, attribution } = sampleData.noi;
  const steps = [
    { key: "prior", labelKey: "Overview.waterfallPrior", kind: "total" as const, delta: 0 },
    ...attribution.map((row) => ({ key: row.driverKey, labelKey: row.driverKey, kind: "delta" as const, delta: row.amount })),
    { key: "current", labelKey: "Overview.waterfallCurrent", kind: "total" as const, delta: 0 },
  ];

  let running = priorValue;
  const bars = steps.map((step, index) => {
    const from = step.kind === "total" ? 0 : running;
    const to = step.kind === "total" ? (index === 0 ? priorValue : value) : running + step.delta;
    if (step.kind === "delta") running = to;
    return { ...step, from, to, index };
  });

  const peak = Math.max(...bars.map((bar) => Math.max(bar.from, bar.to)));
  const chartHeight = 132;
  // Reserved space above the tallest bar for its value label (previously 0 —
  // the label for the tallest bar rendered above y=0 and got clipped by the
  // SVG's own edge) and below the chart for the category labels.
  const topMargin = 24;
  const bottomMargin = 34;
  const scale = chartHeight / (peak * 1.08);
  const barWidth = 68;
  const gap = 18;
  const chartWidth = bars.length * barWidth + (bars.length - 1) * gap;

  return (
    <div className="waterfall" data-reveal data-sound-reveal>
      <svg viewBox={`0 0 ${chartWidth} ${topMargin + chartHeight + bottomMargin}`} width="100%" role="img" aria-label={t("Overview.waterfallAriaLabel")}>
        {bars.map((bar) => {
          const x = bar.index * (barWidth + gap);
          const topValue = Math.max(bar.from, bar.to);
          const bottomValue = Math.min(bar.from, bar.to);
          const y = topMargin + (chartHeight - topValue * scale);
          const barHeight = Math.max(2, (topValue - bottomValue) * scale);
          const isPositive = bar.kind === "total" || bar.delta >= 0;
          return (
            <g key={bar.key} className="waterfall-bar" style={{ "--bar-delay": `${bar.index * 90}ms` } as React.CSSProperties}>
              {bar.index > 0 && bar.kind === "delta" && (
                <line
                  x1={x - gap} x2={x}
                  y1={topMargin + (chartHeight - bar.from * scale)} y2={topMargin + (chartHeight - bar.from * scale)}
                  className="waterfall-connector"
                />
              )}
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} className={`waterfall-rect ${bar.kind} ${isPositive ? "positive" : "negative"}`} />
              <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" className="waterfall-value">
                {bar.kind === "total" ? money(bar.to) : `${bar.delta >= 0 ? "+" : "−"}${money(bar.delta)}`}
              </text>
              <text x={x + barWidth / 2} y={topMargin + chartHeight + 20} textAnchor="middle" className="waterfall-label">
                {t(bar.labelKey)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ConnectionDialog({ provider, onClose, onRefresh }: { provider: Provider | null; onClose: () => void; onRefresh: () => void }) {
  const { celebrate, notify } = useExperience();
  const t = useTranslations(); const [credentials, setCredentials] = useState<Record<string, string>>({}); const [status, setStatus] = useState<"idle" | "working" | "error" | "saved">("idle"); const [message, setMessage] = useState("");
  if (!provider) return null; const providerGuide = guides[provider.id] ?? { aval: ["Secure provider adapter"], customer: ["Administrator consent"], proof: "The upstream identity is verified before sync." }; const blocked = provider.authMode === "oauth2" && provider.configured === false;
  const connect = async (event?: FormEvent) => { event?.preventDefault(); setStatus("working"); setMessage(""); try { const response = await fetch("/api/integrations/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: provider.id, credentials: provider.authMode === "oauth2" ? undefined : credentials, returnTo: `/?view=connections&connected=${provider.id}` }) }); const data = await response.json() as { authorizationUrl?: string; error?: string; required?: string[]; missing?: string[]; connection?: { id: string } }; if (!response.ok) throw new Error(`${data.error ?? "Connection failed"}${data.required ? `: ${data.required.join(", ")}` : ""}${data.missing ? `: ${data.missing.join(", ")}` : ""}`); if (data.authorizationUrl) { window.location.href = data.authorizationUrl; return; } if (!data.connection?.id) throw new Error("Encrypted connection was not returned."); const verification = await fetch("/api/integrations/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: data.connection.id }) }); const verified = await verification.json() as { error?: string; connection?: { externalAccountName?: string } }; if (!verification.ok) { setStatus("saved"); setMessage(`${t("ConnectionDialog.credentialsEncryptedProviderActionRemains")} ${verified.error ?? provider.note}`); notify(t("ConnectionDialog.setupSaved"), provider.title); onRefresh(); return; } setStatus("saved"); setMessage(t("ConnectionDialog.identityVerifiedInitialSyncIsQueued")); celebrate(t("ConnectionDialog.connectionVerified"), verified.connection?.externalAccountName ?? provider.title); onRefresh(); } catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Connection failed"); } };
  return <Dialog.Root open onOpenChange={(open) => !open && onClose()}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="connection-dialog"><div className="dialog-top"><BrandMark provider={provider.id}/><Dialog.Close className="icon-button"><Xmark width={20} height={20}/></Dialog.Close></div><Dialog.Title>{provider.title}</Dialog.Title><Dialog.Description>{provider.description}</Dialog.Description><div className="dialog-status-row"><span><ShieldCheck width={16} height={16}/>{provider.readOnly ? t("ConnectionDialog.readAccess") : t("ConnectionDialog.twoWayChannel")}</span><span><Key width={16} height={16}/>{provider.authMode.replace("_", " ")}</span><span><NetworkLeft width={16} height={16}/>{provider.webhook ? "Webhook + sync" : t("ConnectionDialog.scheduledSync")}</span></div><Tabs.Root defaultValue="readiness"><Tabs.List className="dialog-tabs three"><Tabs.Trigger value="readiness">{t("ConnectionDialog.readiness")}</Tabs.Trigger><Tabs.Trigger value="access">{t("ConnectionDialog.access")}</Tabs.Trigger><Tabs.Trigger value="flow">{t("ConnectionDialog.flow")}</Tabs.Trigger></Tabs.List><Tabs.Content value="readiness"><div className="readiness-grid"><div><p>{t("ConnectionDialog.avalConfiguresOnce")}</p>{providerGuide.aval.map((item) => <span key={item}><Check width={15} height={15}/>{item}</span>)}</div><div><p>{t("ConnectionDialog.customerBrings")}</p>{providerGuide.customer.map((item) => <span key={item}><User width={15} height={15}/>{item}</span>)}</div></div><p className="proof-note"><ShieldCheck width={16} height={16}/>{providerGuide.proof}</p>{blocked && <div className="setup-warning"><strong>{t("ConnectionDialog.notYetAvailableTitle")}</strong><p>{t("ConnectionDialog.notYetAvailableBody")}</p><details className="setup-warning-technical"><summary>{t("ConnectionDialog.technicalReferenceForSupport")}</summary><span>{provider.env.join(" · ")}</span></details></div>}</Tabs.Content><Tabs.Content value="access"><div className="permission-box"><p>{t("ConnectionDialog.avalWillRequest")}</p>{provider.permissions.map((permission) => <span key={permission}><Check width={16} height={16}/>{permission}</span>)}</div><p className="connection-note">{provider.note}</p></Tabs.Content><Tabs.Content value="flow"><ol className="architecture-list"><li><b>01</b><span><strong>{t("ConnectionDialog.authorize")}</strong>{t("ConnectionDialog.consentIsScopedToThisWorkspace")}</span></li><li><b>02</b><span><strong>{t("ConnectionDialog.verify")}</strong>{t("ConnectionDialog.avalTestsTheActualUpstreamIdentity")}</span></li><li><b>03</b><span><strong>{t("ConnectionDialog.normalize")}</strong>{t("ConnectionDialog.sourceIdsAndTimestampsRemainTraceable")}</span></li></ol></Tabs.Content></Tabs.Root>{provider.authMode === "qr_link" && <div className="qr-link-panel"><QrPlaceholder/><div><p>{t("ConnectionDialog.qrLinkInstructions")}</p><span className="qr-link-status"><span className="presence-dot"/>{status === "working" ? t("ConnectionDialog.waitingForScan") : t("ConnectionDialog.qrLinkReady")}</span></div></div>}{provider.authMode !== "oauth2" && provider.authMode !== "qr_link" && <form className="credential-form" onSubmit={connect}>{provider.credentialFields?.map((field) => <label key={field.key}>{field.label}<input type={field.secret ? "password" : "text"} value={credentials[field.key] ?? ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} autoComplete="off" required/></label>)}</form>}{message && <p className={`dialog-message ${status}`}>{message}</p>}<div className="dialog-actions"><button className="soft-button" onClick={onClose}>{t("ConnectionDialog.cancel")}</button><button className="primary-button" disabled={status === "working" || status === "saved" || blocked} onClick={() => connect()}>{status === "working" ? (provider.authMode === "qr_link" ? t("ConnectionDialog.waitingForScan") : t("ConnectionDialog.verifying")) : status === "saved" ? t("ConnectionDialog.saved") : blocked ? t("ConnectionDialog.avalSetupRequired") : provider.authMode === "oauth2" ? t("ConnectionDialog.continueToAuthorization") : provider.authMode === "qr_link" ? t("ConnectionDialog.linkDevice") : t("ConnectionDialog.encryptVerify")}<NavArrowRight width={17} height={17}/></button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function DesktopApp({ authMode, displayName, email }: { authMode: AuthMode; displayName: string; email: string }) {
  const initials = displayName.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  const { market, setMarket, theme, setTheme, sounds, setSounds, celebrate, notify } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const { jobs: draftJobs, createJob: createDraftJob, pauseJob: pauseDraftJob, resumeJob: resumeDraftJob, retryJob: retryDraftJob, sendJob: sendDraftJob } = useDraftJobs(currentLocale);
  const router = useRouter();
  const pathname = usePathname();
  const switchLocale = (nextLocale: "en" | "es-mx") => router.replace(pathname, { locale: nextLocale }); const [view, setView] = useState<View>(() => { if (typeof window === "undefined") return "overview"; const requested = new URLSearchParams(window.location.search).get("view") as View | null; return requested && navGroups.some((group) => group.items.some((item) => item.id === requested)) ? requested : "overview"; }); const [dataMode] = useState<DataMode>(() => { if (typeof window === "undefined") return "sample"; const requested = new URLSearchParams(window.location.search).get("data"); return requested === "empty" || requested === "live" ? requested : "sample"; }); const [providers, setProviders] = useState<Provider[]>(fallbackProviders); const [loading, setLoading] = useState(true); const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null); const [collapsed, setCollapsed] = useState(false); const [profile, setProfile] = useState(false); const [notifications, setNotifications] = useState(false); const [notificationItems, setNotificationItems] = useState<NotificationItem[]>(sampleData.notifications.items); const [pendingTarget, setPendingTarget] = useState<NotificationTarget | null>(null); const [targetToken, setTargetToken] = useState(0); const unreadCount = notificationItems.filter((item) => !item.read).length; const accountingProviderId = market === "latam" ? "contpaqi" : "quickbooks";
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus>>(() => Object.fromEntries(sampleData.insights.candidates.map((candidate) => [candidate.id, candidate.initialStatus ?? "pending"])));
  const [sentReceipts, setSentReceipts] = useState<Record<string, InsightRecipient[]>>(() => {
    const receipts: Record<string, InsightRecipient[]> = {};
    for (const candidate of sampleData.insights.candidates) {
      if (candidate.initialStatus === "sent" && candidate.action?.type === "sendReminders") {
        receipts[candidate.id] = candidate.action.recipients;
      }
    }
    return receipts;
  });
  const pendingReviewCount = sampleData.insights.candidates.filter((insight) => insight.actionable && insight.action !== null && reviewStatuses[insight.id] === "pending").length;
  const listFormatter = useMemo(() => new Intl.ListFormat(currentLocale, { style: "long", type: "conjunction" }), [currentLocale]);
  const providerTitle = (id: string) => providers.find((provider) => provider.id === id)?.title ?? id;
  const loadProviders = async () => { try { const response = await fetch("/api/integrations"); const data = await response.json() as { providers?: Provider[] }; if (data.providers?.length) setProviders(data.providers); } catch { /* local preview stays usable */ } setLoading(false); };
  useEffect(() => { queueMicrotask(() => void loadProviders()); const show = () => setNotifications(true); window.addEventListener("aval:notifications", show); const connected = new URLSearchParams(window.location.search).get("connected"); if (connected) { window.setTimeout(() => celebrate(t("DesktopApp.connectionAuthorized"), connected), 250); const url = new URL(window.location.href); url.searchParams.delete("connected"); window.history.replaceState({}, "", url); } return () => window.removeEventListener("aval:notifications", show); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setActiveView = (next: View) => { setView(next); setProfile(false); const url = new URL(window.location.href); url.searchParams.set("view", next); window.history.replaceState({}, "", url); window.scrollTo({ top: 0, behavior: "smooth" }); }; const openConnections = () => setActiveView("connections"); const openProvider = (id: string) => setSelectedProvider(providers.find((provider) => provider.id === id) ?? null); const titleKey = useMemo<string>(() => navGroups.flatMap((group) => group.items).find((item) => item.id === view)?.labelKey ?? "DesktopApp.avalFallback", [view]);
  const resolveNotificationProvider = (item: NotificationItem) => item.provider === "quickbooks" && market === "latam" ? accountingProviderId : item.provider;
  const pushNotification = (item: Omit<NotificationItem, "id" | "minutesAgo" | "read">) => setNotificationItems((current) => [{ ...item, id: `live-${current.length}-${Date.now()}`, minutesAgo: 0, read: false }, ...current]);
  // Single source of truth for every review decision — called from both
  // Overview's insight queue and the Review Center, so a decision made in
  // either place is reflected identically in the other.
  const approveInsight = (insight: InsightCandidate) => {
    setReviewStatuses((current) => ({ ...current, [insight.id]: "approved" }));
    notify(t(insight.titleKey), t("Overview.insightPrepared"));
    window.setTimeout(() => pushNotification({
      provider: "aval",
      titleKey: insight.titleKey,
      detailKey: "Overview.notifApprovedDetail",
      target: { kind: "reviewDraft", insightId: insight.id },
    }), 1100);
  };
  const denyInsight = (insight: InsightCandidate) => {
    setReviewStatuses((current) => ({ ...current, [insight.id]: "denied" }));
    notify(t(insight.titleKey), t("Overview.insightDenied"));
    window.setTimeout(() => pushNotification({
      provider: "aval",
      titleKey: insight.titleKey,
      detailKey: "Overview.notifDeniedDetail",
      target: { kind: "reviewDraft", insightId: insight.id },
    }), 1100);
  };
  const sendReminderBatch = (insight: InsightCandidate, recipients: InsightRecipient[]) => {
    setReviewStatuses((current) => ({ ...current, [insight.id]: "sent" }));
    setSentReceipts((current) => ({ ...current, [insight.id]: recipients }));
    const channels = listFormatter.format([...new Set(recipients.map((recipient) => providerTitle(recipient.channel)))]);
    notify(t(insight.titleKey), t("Overview.remindersSentDetail", { count: recipients.length, channels }));
    window.setTimeout(() => pushNotification({
      provider: recipients[0]?.channel ?? "whatsapp",
      titleKey: insight.titleKey,
      detailKey: "Overview.remindersSentDetail",
      detailParams: { count: recipients.length, channels },
      target: { kind: "reminderReceipt", insightId: insight.id },
    }), 1100);
  };
  const openNotification = (item: NotificationItem) => {
    setNotificationItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
    setNotifications(false);
    const target = item.target;
    if (target.kind === "connectionProvider") {
      setActiveView("connections");
      openProvider(target.providerId === "quickbooks" ? accountingProviderId : target.providerId);
      return;
    }
    setActiveView(target.kind === "inboxThread" ? "inbox" : "overview");
    setPendingTarget(target);
    setTargetToken((token) => token + 1);
  };
  const navCounts: Partial<Record<View, number>> = { reviewCenter: pendingReviewCount };
  const signOutOfPasswordAccount = () => { fetch("/api/auth/logout", { method: "POST" }).finally(() => { window.location.href = "/"; }); };
  return <main className={`app-shell ${collapsed ? "sidebar-is-collapsed" : ""}`}><aside className="sidebar"><div className="brand-lockup"><span className="brand-symbol">a</span><div><strong>aval</strong><small>{t("DesktopApp.propertyOperations")}</small></div><button className="icon-button sidebar-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={t("DesktopApp.collapseSidebar")}><ViewColumns3 width={18} height={18}/></button></div><nav>{navGroups.map((group) => <div className="nav-group" key={group.labelKey}><p>{t(group.labelKey)}</p>{group.items.map((item) => { const Icon = item.icon; const count = navCounts[item.id] ?? item.count; return <button className={view === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} key={item.id} title={t(item.labelKey)}><Icon width={20} height={20}/><span>{t(item.labelKey)}</span>{Boolean(count) && <b>{count}</b>}{view === item.id && <NavArrowRight className="nav-chevron" width={16} height={16}/>}</button>; })}</div>)}</nav><button className="workspace-card" onClick={() => setProfile(!profile)}><span className="initials">{initials}</span><span><strong>{displayName}</strong><small>{email}</small></span><span className="icon-button"><NavArrowDown width={16} height={16}/></span></button>{profile && <div className="profile-menu"><div><span className="initials">{initials}</span><span><strong>{displayName}</strong><small>{email}</small></span></div><button onClick={() => setActiveView("settings")}><Settings width={17} height={17}/>{t("DesktopApp.profileSettings")}</button><button onClick={() => switchLocale(currentLocale === "en" ? "es-mx" : "en")}><Language width={17} height={17}/>{currentLocale === "en" ? "Español (México)" : "English"}</button><button onClick={() => setMarket(market === "us" ? "latam" : "us")}><Globe width={17} height={17}/>{market === "us" ? t("DesktopApp.marketUnitedStates") : t("DesktopApp.marketLatam")}</button><button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <HalfMoon width={17} height={17}/> : <SunLight width={17} height={17}/>} {theme === "light" ? t("DesktopApp.darkMode") : t("DesktopApp.lightMode")}</button><button onClick={() => setSounds(!sounds)}>{sounds ? <SoundHigh width={17} height={17}/> : <SoundOff width={17} height={17}/>} {sounds ? t("DesktopApp.soundsOn") : t("DesktopApp.soundsOff")}</button><Link href="/mobile"><SmartphoneDevice width={17} height={17}/>{t("DesktopApp.openMobileApp")}</Link>
      {authMode === "password"
        ? <button type="button" onClick={signOutOfPasswordAccount}><LogOut width={17} height={17}/>{t("DesktopApp.signOut")}</button>
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- external platform sign-out route, not part of this app router
        : <a href="/signout-with-chatgpt?return_to=/"><LogOut width={17} height={17}/>{t("DesktopApp.signOut")}</a>}
      </div>}</aside><section className="content-shell" aria-label={t(titleKey)}>{view === "overview" && <Overview openConnections={openConnections} dataMode={dataMode} providers={providers} pendingTarget={pendingTarget} targetToken={targetToken} reviewStatuses={reviewStatuses} sentReceipts={sentReceipts} onApprove={approveInsight} onDeny={denyInsight} onSendReminders={sendReminderBatch}/>} {view === "tasks" && <TasksView draftJobs={draftJobs} onCreateDraft={createDraftJob} onPauseDraft={pauseDraftJob} onResumeDraft={resumeDraftJob} onRetryDraft={retryDraftJob} onSendDraft={sendDraftJob}/>} {view === "reviewCenter" && <ReviewCenterView reviewStatuses={reviewStatuses} sentReceipts={sentReceipts} onApprove={approveInsight} onDeny={denyInsight} onSendReminders={sendReminderBatch}/>} {view === "inbox" && <InboxView pendingTarget={pendingTarget} targetToken={targetToken}/>} {view === "connections" && <ConnectionsView providers={providers} loading={loading} onOpen={openProvider}/>} {view === "settings" && <SettingsView openConnections={openConnections} displayName={displayName} email={email}/>} {(["properties", "leasing", "maintenance", "accounting", "documents"] as View[]).includes(view) && <OperationsView view={view} openConnections={openConnections} dataMode={dataMode} providers={providers}/>}</section>{selectedProvider && <ConnectionDialog provider={selectedProvider} onClose={() => setSelectedProvider(null)} onRefresh={loadProviders}/>}<Dialog.Root open={notifications} onOpenChange={setNotifications}><Dialog.Portal><Dialog.Overlay className="dialog-overlay subtle"/><Dialog.Content className="notification-drawer"><div className="drawer-heading"><div><p className="eyebrow">{t("DesktopApp.liveWorkspace")}</p><Dialog.Title>{t("DesktopApp.notifications")}</Dialog.Title></div><Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close></div><div className="notification-list">{notificationItems.map((item) => <button key={item.id} className={item.read ? "" : "unread"} onClick={() => openNotification(item)}><BrandMark provider={resolveNotificationProvider(item)} small/><span><strong>{t(item.titleKey)}</strong><small>{t(item.detailKey, item.detailParams)}</small></span><span className="notif-trailing">{!item.read && <i className="unread-dot"/>}<time>{formatMinutesAgo(item.minutesAgo, currentLocale)}</time></span></button>)}</div><button className="wide-button" onClick={() => setNotificationItems((current) => current.map((item) => ({ ...item, read: true })))}><Check width={17} height={17}/>{unreadCount ? t("DesktopApp.markAllAsRead") : t("DesktopApp.allCaughtUp")}</button></Dialog.Content></Dialog.Portal></Dialog.Root><AvalAssistant view={view} onCreateDraft={createDraftJob}/></main>;
}

export function AvalDashboard({ authMode, displayName, email }: { authMode: AuthMode; displayName: string; email: string }) { return <ExperienceProvider><DesktopApp authMode={authMode} displayName={displayName} email={email}/></ExperienceProvider>; }
