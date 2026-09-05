"use client";
/* eslint-disable jsx-a11y/no-autofocus */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import type { DateRange } from "react-day-picker";
import { enUS, es } from "date-fns/locale";
import {
  Archive, Attachment, Bell, Calendar, ChatLines, Check, CheckCircle, ClipboardCheck, Clock,
  Coins, CoinsSwap, Dashboard, Database, Flash, Globe, HalfMoon, HomeSimpleDoor, Key,
  Language, LogOut, NetworkLeft, NavArrowDown, NavArrowRight, Page,
  Phone, Plus, ScaleFrameEnlarge, ScaleFrameReduce, Search, SendDiagonal, Settings, ShieldCheck,
  Refresh, SoundHigh, SoundOff, StatsUpSquare, SunLight, TaskList, Tools, User, WarningTriangle,
  ViewColumns3, Xmark, XmarkCircle,
} from "iconoir-react";
import { AnimatedNumber, ExperienceProvider, useExperience, usePrefersReducedMotion } from "@/app/components/experience";
import { useRouter, usePathname } from "./navigation";
import { AvalAssistant } from "@/app/components/aval-assistant";
import type { AuthMode } from "@/app/components/auth-gate";
import { AskAvalTasksSection, useDraftJobs, type CreateDraftInput, type DraftJob } from "@/app/components/ask-aval-tasks";
import { AppearanceProvider } from "@/app/components/appearance-provider";
import { ProfileAvatar } from "@/app/components/character-avatar";
import { SettingsModule } from "@/app/components/settings-module";
import { BrandMark } from "@/app/components/brand-mark";
import { DesktopServiceBar } from "@/app/components/desktop-codex";
import { ConnectionDialog, type Provider } from "@/app/components/connection-dialog";
import { AutomationTimeline } from "@/app/components/automation-timeline";
import { AgentTrace } from "@/app/components/agent-trace";
import { activityIntensity, buildActivityYear, derivedSample, rankInsights, sampleData, type InsightCandidate, type InsightRecipient, type NotificationItem, type NotificationTarget, type ReviewStatus } from "@/app/data/sample";
import { formatMoney } from "@/lib/finance/money";
import { AvalAgentAvatar } from "@/app/components/agent-avatar/AgentAvatar";
import { DATA_SOURCE_NODES, PERSONA_IDS, PERSONA_PRESETS, PERSONA_TOOL_ACCESS, type PersonaId } from "@/app/components/agent-avatar/personas";
import { buildingAssets, capitalForecast, complianceItems, fixtureLoad, FIXTURE_UNIT_TABLE_CEILING, infrastructureSummary, preventiveTasks, totalAnnualReserveCents, type AssetCategory, type AssetCondition, type DueStatus } from "@/app/data/infrastructure-sample";
import type { UtilityType } from "@/lib/infrastructure/types";
import { DocumentUploader } from "@/app/components/document-uploader";
import { IntegrationsCatalog } from "@/app/components/integrations-catalog";
import { PlanningWorkspace } from "@/app/components/planning-workspace";
import { OperationsWorkspace } from "@/app/components/operations-workspace";
import { Calendar as RangeCalendar } from "@/components/ui/calendar-with-presets";

type View = "calendar" | "projects" | "teams" | "overview" | "tasks" | "reviewCenter" | "inbox" | "properties" | "leasing" | "maintenance" | "accounting" | "infrastructure" | "connections" | "documents" | "setup" | "settings";
type DataMode = "sample" | "empty" | "live";
type IconComponent = ComponentType<{ width?: number; height?: number; className?: string }>;
type T = ReturnType<typeof useTranslations>;

const navGroups: { labelKey: string; items: { id: View; labelKey: string; icon: IconComponent; count?: number }[] }[] = [
  { labelKey: "Nav.agent", items: [
    { id: "overview", labelKey: "Nav.portfolioOverview", icon: Dashboard },
    { id: "setup", labelKey: "Nav.setup", icon: NetworkLeft },
    { id: "tasks", labelKey: "Nav.avalTasks", icon: TaskList, count: 4 },
    { id: "reviewCenter", labelKey: "Nav.reviewCenter", icon: ClipboardCheck },
    { id: "inbox", labelKey: "Nav.sharedInbox", icon: ChatLines, count: 7 },
  ]},
  { labelKey: "Nav.operations", items: [
    { id: "properties", labelKey: "Nav.properties", icon: HomeSimpleDoor },
    { id: "leasing", labelKey: "Nav.leasing", icon: User },
    { id: "maintenance", labelKey: "Nav.maintenance", icon: Tools },
    { id: "accounting", labelKey: "Nav.accounting", icon: CoinsSwap },
    { id: "infrastructure", labelKey: "Nav.infrastructure", icon: Flash },
  ]},
  { labelKey: "Nav.planning", items: [
    { id: "calendar", labelKey: "Nav.calendar", icon: Calendar },
    { id: "projects", labelKey: "Nav.projects", icon: ViewColumns3 },
    { id: "teams", labelKey: "Nav.teams", icon: User },
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
function formatDateRange(start: Date, end: Date, locale: string): string {
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
  const dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric" });
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${monthFmt.format(start)} ${dayFmt.format(start)}–${dayFmt.format(end)}`
    : `${monthFmt.format(start)} ${dayFmt.format(start)} – ${monthFmt.format(end)} ${dayFmt.format(end)}`;
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

/** A reusable shadcn/DayPicker range calendar with operational presets. */
function DateRangePicker({ period, onChange, t, locale }: { period: string; onChange: (label: string) => void; t: T; locale: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(SAMPLE_TODAY.getFullYear(), SAMPLE_TODAY.getMonth() - 1, 1));
  const [date, setDate] = useState<DateRange | undefined>({ from: addDays(SAMPLE_TODAY, -6), to: SAMPLE_TODAY });

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    setDate({ from: preset.range[0], to: preset.range[1] });
    setMonth(preset.range[0]);
    onChange(formatDateRange(preset.range[0], preset.range[1], locale));
    setOpen(false);
  };

  const selectRange = (next: DateRange | undefined) => {
    setDate(next);
    if (!next?.from || !next.to) return;
    onChange(formatDateRange(next.from, next.to, locale));
    setOpen(false);
  };

  return (
    <details className="app-menu date-range-menu" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="soft-button"><Calendar width={18} height={18}/>{period}<NavArrowDown width={16} height={16}/></summary>
      <div className="menu-popover date-range-popover">
        <aside className="date-preset-list" aria-label={t("Overview.periodCustomRange")}>
          {DATE_PRESETS.map((preset) => <button type="button" key={preset.labelKey} onClick={() => applyPreset(preset)}>{t(preset.labelKey)}</button>)}
        </aside>
        <div className="date-calendar-wrap">
          <RangeCalendar
            mode="range"
            month={month}
            onMonthChange={setMonth}
            selected={date}
            onSelect={selectRange}
            numberOfMonths={2}
            locale={locale.toLowerCase().startsWith("es") ? es : enUS}
            labels={{
              labelPrevious: () => t("Overview.previousMonth"),
              labelNext: () => t("Overview.nextMonth"),
            }}
            disabled={{ after: SAMPLE_TODAY }}
            endMonth={SAMPLE_TODAY}
            fixedWeeks
            className="date-calendar"
          />
          <p className="date-calendar-hint">{date?.from && !date.to ? t("Overview.selectEndDate") : t("Overview.selectStartDate")}</p>
        </div>
      </div>
    </details>
  );
}

/** The phrases the hero cycles through. Each is a full sentence, typed then cleared. */
const HERO_PHRASE_KEYS = [
  "Overview.heroPhraseAllInOnePlace",
  "Overview.heroPhraseLeasingToLedger",
  "Overview.heroPhraseEveryDoorEveryDollar",
  "Overview.heroPhraseAnswersNotDashboards",
] as const;

/**
 * Types a phrase out, holds it, clears it, moves to the next — the marquee
 * line under the greeting.
 *
 * Honors `prefers-reduced-motion` by showing the first phrase statically:
 * a caret blinking through a retyping sentence is exactly the kind of
 * continuous motion that setting exists to turn off. Also pauses while the
 * tab is hidden, so returning to a backgrounded dashboard doesn't land
 * mid-word after thousands of wasted timer ticks.
 */
function useTypewriter(phrases: string[]): { text: string; typing: boolean } {
  const reduceMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [erasing, setErasing] = useState(false);

  const phrase = phrases[index % phrases.length] ?? "";

  useEffect(() => {
    if (reduceMotion || phrases.length === 0) return;
    // Typing is quick, erasing quicker, and a finished sentence holds long
    // enough to actually be read before it starts disappearing.
    const done = length >= phrase.length;
    const delay = erasing ? 24 : done ? 2100 : 52;
    const timer = window.setTimeout(() => {
      if (erasing) {
        if (length <= 0) { setErasing(false); setIndex((current) => (current + 1) % phrases.length); }
        else setLength((current) => current - 1);
        return;
      }
      if (done) { setErasing(true); return; }
      setLength((current) => current + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [length, erasing, phrase, phrases.length, reduceMotion]);

  if (reduceMotion) return { text: phrases[0] ?? "", typing: false };
  return { text: phrase.slice(0, length), typing: true };
}

/** Whole days since the workspace was created, inclusive of today. */
export function daysSince(createdAt: Date, now: Date): number {
  const start = Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.floor((today - start) / 86_400_000) + 1);
}

/**
 * The dashboard's opening block: who's here, how long they've been here, and
 * a typed line, over the year-of-activity heatmap.
 */
function OverviewHero({ displayName, t, locale }: { displayName: string; t: T; locale: string }) {
  const phrases = useMemo(() => HERO_PHRASE_KEYS.map((key) => t(key)), [t]);
  const { text, typing } = useTypewriter(phrases);
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  const [days, setDays] = useState<number | null>(null);

  // Fetched rather than server-rendered (see page.tsx). Stays null — and the
  // counter stays hidden — if the call fails or the date is unparseable: a
  // fabricated "day 1" would be worse than no counter at all.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace")
      .then((response) => (response.ok ? response.json() as Promise<{ createdAt?: string }> : null))
      .then((body) => {
        if (cancelled || !body?.createdAt) return;
        const created = new Date(body.createdAt);
        if (!Number.isNaN(created.getTime())) setDays(daysSince(created, new Date()));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return <section className="overview-hero" data-reveal>
    <div className="overview-hero-copy">
      <p className="eyebrow">{t("Overview.heroEyebrow")}</p>
      <h1>{t("Overview.heroWelcome", { name: firstName })}</h1>
      {days !== null && <p className="overview-hero-days">
        <AnimatedNumber value={days}/> <span>{t("Overview.heroDaysWithAval", { count: days })}</span>
      </p>}
      <p className="overview-hero-typed" aria-live="off">
        <span>{text}</span>
        {typing && <i className="type-caret" aria-hidden="true"/>}
      </p>
      {/* The full set, readable by assistive tech and search without
          depending on the animation's current frame. */}
      <span className="visually-hidden">{phrases.join(". ")}</span>
    </div>
    <ActivityHeatmap t={t} locale={locale} compact/>
  </section>;
}

/**
 * A year of daily activity as a heatmap. Reads the same class of work the
 * ledger and history drawer itemize — verified actions Aval completed — so the
 * three surfaces describe one underlying stream rather than three metrics.
 */
function ActivityHeatmap({ t, locale, compact = false }: { t: T; locale: string; compact?: boolean }) {
  const weeks = useMemo(() => buildActivityYear(SAMPLE_TODAY), []);
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short" }), [locale]);
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long" }), [locale]);

  // Sunday-first, matching the grid's own row order. Only every other label is
  // shown — seven stacked labels at this row height reads as noise.
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => (index % 2 === 1 ? weekdayFmt.format(new Date(2026, 7, 9 + index)) : ""));

  // One label per column, printed only where the month actually turns over.
  // Keyed off the month the previous column already showed rather than off a
  // "is there a day 1-7 in this week" test — a week straddling a boundary and
  // the week after it both contain such a day, which double-prints the name.
  // The leading column is usually a partial month whose label would sit off the
  // left edge of its own run of weeks, so it stays blank.
  const monthLabels = weeks.map((week, index) => {
    if (index === 0) return "";
    const last = week[week.length - 1].date;
    const previousLast = weeks[index - 1][weeks[index - 1].length - 1].date;
    return last.getMonth() === previousLast.getMonth() ? "" : monthFmt.format(last);
  });

  return <div className={`activity-heatmap${compact ? " is-compact" : ""}`}>
    <div className="activity-heatmap-weekdays" aria-hidden="true">{weekdayLabels.map((label, index) => <span key={index}>{label}</span>)}</div>
    <div className="activity-heatmap-body">
      <div className="activity-heatmap-months" aria-hidden="true">{monthLabels.map((label, index) => <span key={index}>{label}</span>)}</div>
      <div className="activity-heatmap-grid" role="img" aria-label={t("Overview.activityHeatmapAria")}>
        {weeks.map((week, weekIndex) => <div className="activity-heatmap-week" key={weekIndex}>
          {week.map((day) => <div
            className="activity-heatmap-day"
            key={day.date.toISOString()}
            data-level={activityIntensity(day.count)}
            title={day.count < 0 ? dayFmt.format(day.date) : t("Overview.activityDayTooltip", { date: dayFmt.format(day.date), count: day.count })}
          />)}
        </div>)}
      </div>
      <div className="activity-heatmap-legend">
        <span>{t("Overview.activityLess")}</span>
        {[0, 1, 2, 3, 4].map((level) => <div className="activity-heatmap-day" data-level={level} key={level}/>)}
        <span>{t("Overview.activityMore")}</span>
      </div>
    </div>
  </div>;
}

function Overview({ displayName, openConnections, dataMode, providers, pendingTarget, targetToken, reviewStatuses, sentReceipts, onApprove, onDeny, onSendReminders, onCreateDraft }: {
  displayName: string;
  openConnections: () => void; dataMode: DataMode; providers: Provider[];
  pendingTarget: NotificationTarget | null; targetToken: number;
  reviewStatuses: Record<string, ReviewStatus>; sentReceipts: Record<string, InsightRecipient[]>;
  onApprove: (insight: InsightCandidate) => void; onDeny: (insight: InsightCandidate) => void;
  onSendReminders: (insight: InsightCandidate, recipients: InsightRecipient[]) => void;
  onCreateDraft: (input: CreateDraftInput) => void;
}) {
  const { market, notify } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const currencyPrefix = market === "latam" ? "MX$" : "$";
  const accountingProvider = market === "latam" ? "contpaqi" : "quickbooks";
  const [period, setPeriod] = useState("Aug 12–18");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftExpanded, setDraftExpanded] = useState(false);
  const isSample = dataMode === "sample";
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

  // One-click weekly digest: reuses the exact draft/export pipeline Ask Aval
  // Tasks already uses, so every figure still passes through the same
  // tool-loop and faithfulness gate. Aval never assembles this from
  // on-screen state directly.
  const generateWeeklyReport = () => {
    onCreateDraft({
      title: `Weekly portfolio report: ${period}`,
      instructions: "Compile this week's portfolio digest in five sections, in this order: (1) Net operating income, with the period-over-period change. (2) Occupancy, portfolio-wide and by property, naming any property below the portfolio average. (3) Rent collections and delinquency, naming past-due accounts and the total amount at risk. (4) Leasing funnel performance, the conversion rate at each stage from inquiry to signed lease. (5) Maintenance load, the volume and cost of open work orders by category. Close with one recommended next action grounded in the numbers above.",
      format: "docx",
      documentType: "Weekly report",
    });
    notify(t("Overview.weeklyReportStarted"), t("Overview.weeklyReportStartedDetail"));
  };

  return <div className="view-wrap">
    <OverviewHero displayName={displayName} t={t} locale={currentLocale}/>
    <AppHeader
      title={t("Overview.portfolioOverview")}
      subtitle={dataMode === "live"
        ? t("Overview.aCalmLiveReadOnLeasing")
        : t("Overview.aCalmReadOnLeasingCash")}
      actions={<>
        <DateRangePicker period={period} onChange={setPeriod} t={t} locale={currentLocale}/>
        <button className="soft-button" onClick={generateWeeklyReport}><Page width={18} height={18}/>{t("Overview.generateWeeklyReport")}</button>
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

function TasksView({ isGuest, draftJobs, onCreateDraft, onPauseDraft, onResumeDraft, onRetryDraft, onSendDraft }: {
  isGuest: boolean; draftJobs: DraftJob[]; onCreateDraft: (input: CreateDraftInput) => void; onPauseDraft: (id: string) => void; onResumeDraft: (id: string) => void; onRetryDraft: (id: string) => void; onSendDraft: (id: string, recipient: string) => void;
}) {
  return <PlanningWorkspace view="tasks" isGuest={isGuest} activity={<><AskAvalTasksSection jobs={draftJobs} onCreate={onCreateDraft} onPause={onPauseDraft} onResume={onResumeDraft} onRetry={onRetryDraft} onSend={onSendDraft}/><AgentTrace/><AutomationTimeline/></>}/>;
}

const inboxItems = [
  { name: "Marcus Lee", unit: "Franklin House · 4B", text: "Tomorrow at three works perfectly.", provider: "apple_messages", time: "2m", unread: 2 },
  { name: "Diana Ortiz", unit: "Monroe Court · 2A", text: "Could we split this month's balance?", provider: "whatsapp", time: "11m", unread: 1 },
  { name: "Alvarez Plumbing", unit: "Vendor · Maintenance", text: "Estimate attached for the boiler.", provider: "outlook", time: "24m", unread: 0 },
  { name: "Portfolio team", unit: "Slack · #operations", text: "Approved. Go ahead and send it.", provider: "slack", time: "41m", unread: 0 },
];
interface RealConversationMessage { id: string; direction: string; body: string; createdAt: number }
interface RealConversation { id: string; channel: string; contactDisplayName: string; lastMessageAt: number; draftReply: string | null; draftReplyStatus: string | null; messages: RealConversationMessage[] }

// Real threads (from a connected provider's inbound traffic, via
// app/api/webhooks/[provider]/route.ts) sit above the sample list, each
// carrying a reply Ask Aval already drafted the moment the message arrived
// — pre-filled in the composer, still one click from actually sending.
// Empty and invisible until a real provider is connected and sends real
// traffic, so the sample experience below is unchanged until then.
function InboxView({ pendingTarget, targetToken }: { pendingTarget: NotificationTarget | null; targetToken: number }) {
  const { notify } = useExperience();
  const t = useTranslations(); const currentLocale = useLocale(); const [active, setActive] = useState(0); const [selectedRealId, setSelectedRealId] = useState<string | null>(null); const [realConversations, setRealConversations] = useState<RealConversation[]>([]); const current = inboxItems[active]; const selectedReal = selectedRealId ? realConversations.find((conversation) => conversation.id === selectedRealId) ?? null : null; const [reply, setReply] = useState(""); const [sent, setSent] = useState<string[]>([]); const [sending, setSending] = useState(false); const input = useRef<HTMLInputElement>(null); const file = useRef<HTMLInputElement>(null);
  useEffect(() => { (async () => { try { const response = await fetch("/api/conversations"); const data = await response.json() as { conversations?: RealConversation[] }; setRealConversations(data.conversations ?? []); } catch { /* real conversations stay empty until a provider is connected */ } })(); }, []);
  // Deliberately not a useEffect — see the matching comment in Overview.
  const [handledTargetToken, setHandledTargetToken] = useState(0);
  if (pendingTarget && pendingTarget.kind === "inboxThread" && targetToken !== handledTargetToken) {
    setHandledTargetToken(targetToken);
    const index = inboxItems.findIndex((item) => item.name === pendingTarget.contactName);
    if (index >= 0) { setActive(index); setSelectedRealId(null); setSent([]); setReply(""); }
  }
  const selectSample = (index: number) => { setActive(index); setSelectedRealId(null); setSent([]); setReply(""); };
  const selectReal = (conversation: RealConversation) => { setSelectedRealId(conversation.id); setSent([]); setReply(conversation.draftReply ?? ""); };
  const send = async () => {
    if (!reply.trim()) return;
    const text = reply.trim();
    if (selectedReal) {
      setSending(true);
      try {
        await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: selectedReal.id, body: text }) });
        setRealConversations((current) => current.map((conversation) => conversation.id === selectedReal.id ? { ...conversation, draftReply: null, draftReplyStatus: null, messages: [...conversation.messages, { id: `local-${Date.now()}`, direction: "outbound", body: text, createdAt: Date.now() }] } : conversation));
      } finally { setSending(false); }
      notify(t("InboxView.messageSent"), `${t("InboxView.via")} ${selectedReal.channel.replace("_", " ")}`);
    } else {
      setSent((messages) => [...messages, text]);
      notify(t("InboxView.messageSent"), `${t("InboxView.via")} ${current.provider.replace("_", " ")}`);
    }
    setReply("");
  };
  return <div className="view-wrap"><AppHeader title={t("InboxView.sharedInbox")} subtitle={t("InboxView.oneResidentTimelineAcrossEveryConnected")} actions={<button className="primary-button" onClick={() => input.current?.focus()}><Plus width={18} height={18}/>{t("InboxView.newMessage")}</button>}/><div className="inbox-window" data-reveal><aside className="conversation-list"><label className="search-field"><Search width={18} height={18}/><input placeholder={t("InboxView.searchConversations")}/></label>{realConversations.map((conversation) => { const lastMessage = conversation.messages[conversation.messages.length - 1]; return <button className={`conversation-row ${selectedRealId === conversation.id ? "active" : ""}`} onClick={() => selectReal(conversation)} key={conversation.id}><BrandMark provider={conversation.channel} small/><span><strong>{conversation.contactDisplayName}</strong><small className="live-badge">{t("InboxView.liveBadge")}</small><em>{lastMessage?.body ?? ""}</em></span>{conversation.draftReplyStatus === "ready" && <i className="draft-ready-dot" aria-label={t("InboxView.draftReady")}/>}</button>; })}{inboxItems.map((item, index) => <button className={`conversation-row ${!selectedReal && active === index ? "active" : ""}`} onClick={() => selectSample(index)} key={item.name}><BrandMark provider={item.provider} small/><span><strong>{item.name}</strong><small>{item.unit}</small><em>{item.text}</em></span><i>{item.time}</i>{item.unread > 0 && <b>{item.unread}</b>}</button>)}</aside>{selectedReal ? <section className="message-thread"><header><div><BrandMark provider={selectedReal.channel} small/><div><strong>{selectedReal.contactDisplayName}</strong><span>{t("InboxView.liveBadge")}</span></div></div></header><div className="message-canvas">{selectedReal.messages.map((message) => <div className={`message ${message.direction === "inbound" ? "received" : "sent"}`} key={message.id}><p>{message.body}</p><span>{new Date(message.createdAt).toLocaleTimeString(currentLocale, { hour: "2-digit", minute: "2-digit" })}</span></div>)}{selectedReal.draftReply && <div className="message sent draft-pending"><p>{selectedReal.draftReply}</p><span>{t("InboxView.draftReadyToSend")}</span></div>}</div><footer className="composer"><input ref={input} value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={t("InboxView.writeAReplyOrAskAval")}/><button className="primary-button" onClick={send} disabled={sending}><SendDiagonal width={17} height={17}/>{t("InboxView.send")}</button></footer></section> : <section className="message-thread"><header><div><BrandMark provider={current.provider} small/><div><strong>{current.name}</strong><span>{current.unit}</span></div></div><button className="icon-button" onClick={() => notify(t("InboxView.calling"), `${current.name} · Twilio`)} aria-label={t("InboxView.call")}><Phone width={20} height={20}/></button></header><div className="message-canvas"><div className="date-divider">{t("InboxView.today")}</div><div className="message received"><p>{t("InboxView.mockQuestionAboutNextStep")}</p><span>14:18</span></div><div className="message sent"><p>{t("InboxView.mockViewingHeld")}</p><span>14:19 · {t("InboxView.mockDraftApproved")}</span></div><div className="message received"><p>{current.text}</p><span>14:21</span></div>{sent.map((message, index) => <div className="message sent" key={`${message}-${index}`}><p>{message}</p><span>{t("InboxView.nowDelivered")}</span></div>)}</div><footer className="composer"><input ref={file} type="file" hidden onChange={() => notify(t("InboxView.attachmentReady"), file.current?.files?.[0]?.name)}/><button className="icon-button" onClick={() => file.current?.click()} aria-label={t("InboxView.attach")}><Attachment width={19} height={19}/></button><input ref={input} value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={t("InboxView.writeAReplyOrAskAval")}/><button className="primary-button" onClick={send}><SendDiagonal width={17} height={17}/>{t("InboxView.send")}</button></footer></section>}<aside className="contact-panel">{selectedReal ? <><p className="eyebrow">{t("InboxView.residentContext")}</p><div className="profile-block"><span className="initials">{selectedReal.contactDisplayName.split(" ").map((part) => part[0]).join("")}</span><h3>{selectedReal.contactDisplayName}</h3><p>{t("InboxView.liveBadge")}</p></div><dl><div><dt>{t("InboxView.source")}</dt><dd>{selectedReal.channel.replace("_", " ")}</dd></div></dl></> : <><p className="eyebrow">{t("InboxView.residentContext")}</p><div className="profile-block"><span className="initials">{current.name.split(" ").map((part) => part[0]).join("")}</span><h3>{current.name}</h3><p>{current.unit}</p></div><dl><div><dt>{t("InboxView.stage")}</dt><dd>{t("InboxView.viewingBooked")}</dd></div><div><dt>{t("InboxView.source")}</dt><dd>{current.provider.replace("_", " ")}</dd></div><div><dt>{t("InboxView.owner")}</dt><dd>{t("InboxView.leasingTeam")}</dd></div></dl><button className="wide-button" onClick={() => notify(t("InboxView.residentRecordOpened"), current.name)}>{t("InboxView.openResidentRecord")}<NavArrowRight width={17} height={17}/></button></>}</aside></div></div>;
}

function ConnectionsView({ providers, loading, onOpen }: { providers: Provider[]; loading: boolean; onOpen: (id: string) => void }) {
  return <IntegrationsCatalog providers={providers} loading={loading} onOpen={onOpen}/>;
}

interface DocumentRow { id: string; title: string; kind: string; charCount: number; createdAt: string }
interface ExtractedFieldRow { label: string; value: string | null; sourceQuote: string | null }
interface ExtractionResult { fields: ExtractedFieldRow[]; note: string | null; truncated: boolean }

const DOCUMENT_KIND_LABEL_KEY: Record<string, string> = {
  lease: "DocumentsView.kindLease",
  ownerStatement: "DocumentsView.kindOwnerStatement",
  lenderStatement: "DocumentsView.kindLenderStatement",
  vendorEstimate: "DocumentsView.kindVendorEstimate",
  other: "DocumentsView.kindOther",
};

const DOCUMENT_KINDS = ["lease", "ownerStatement", "lenderStatement", "vendorEstimate", "other"];

/**
 * Documents — what a workspace has given Aval to read, and the structured
 * reading of any one of them.
 *
 * Extraction is deliberately presented as a draft, not a result: every value
 * shows the document's own wording beside it, and a field the document does
 * not state renders as an explicit "not stated" rather than an empty cell that
 * could be mistaken for a rendering fault. That mirrors how the extraction
 * prompt is written — a blank is a correct answer, an invented value is not.
 */
function DocumentsView({ isGuest }: { isGuest: boolean }) {
  const t = useTranslations();
  const currentLocale = useLocale();
  const { notify } = useExperience();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("lease");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium" }), [currentLocale]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/documents")
      .then((response) => (response.ok ? response.json() as Promise<{ documents: DocumentRow[] }> : null))
      .then((body) => { if (!cancelled && body) setDocuments(body.documents); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, contentText: text }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { document: DocumentRow & { truncated: boolean } };
      setDocuments((current) => [body.document, ...current]);
      setTitle(""); setText(""); setAdding(false);
      // Truncation is surfaced, never silent — an answer drawn from a document
      // whose tail was dropped without saying so is the worst outcome here.
      notify(
        t("DocumentsView.savedTitle"),
        body.document.truncated ? t("DocumentsView.savedTruncated") : t("DocumentsView.savedDetail"),
      );
    } catch {
      notify(t("DocumentsView.saveFailedTitle"), t("DocumentsView.saveFailedDetail"));
    } finally {
      setSaving(false);
    }
  }

  async function extract(documentId: string) {
    setSelectedId(documentId);
    setExtraction(null);
    setExtracting(true);
    try {
      const response = await fetch("/api/documents/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { extraction: ExtractionResult };
      setExtraction(body.extraction);
    } catch {
      notify(t("DocumentsView.readFailedTitle"), t("DocumentsView.readFailedDetail"));
      setSelectedId(null);
    } finally {
      setExtracting(false);
    }
  }

  async function remove(documentId: string) {
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { documents: DocumentRow[] };
      setDocuments(body.documents);
      if (selectedId === documentId) { setSelectedId(null); setExtraction(null); }
    } catch {
      notify(t("DocumentsView.saveFailedTitle"), t("DocumentsView.saveFailedDetail"));
    }
  }

  return <div className="view-wrap documents-view">
    <AppHeader
      title={t("DocumentsView.documents")}
      subtitle={t("DocumentsView.subtitle")}
      actions={<button className="primary-button" onClick={() => setAdding(!adding)}><Plus width={18} height={18}/>{t("DocumentsView.addDocument")}</button>}
    />

    {isGuest && <section className="panel guest-warning" data-reveal>
      <WarningTriangle width={18} height={18}/>
      <div>
        <strong>{t("DocumentsView.guestWarningTitle")}</strong>
        <p>{t("DocumentsView.guestWarningBody")}</p>
      </div>
    </section>}

    <DocumentUploader disabled={isGuest} onUploaded={row => setDocuments(current => [row, ...current.filter(document => document.id !== row.id)])}/>

    {adding && <section className="panel" data-reveal>
      <div className="panel-heading"><div><p className="eyebrow">{t("DocumentsView.newDocument")}</p><h2>{t("DocumentsView.pasteTheText")}</h2></div></div>
      <div className="document-form">
        <div className="document-form-row">
          <input
            className="teach-input"
            placeholder={t("DocumentsView.titlePlaceholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={t("DocumentsView.titlePlaceholder")}
          />
          <select className="document-kind-select" value={kind} onChange={(event) => setKind(event.target.value)} aria-label={t("DocumentsView.kind")}>
            {DOCUMENT_KINDS.map((option) => <option key={option} value={option}>{t(DOCUMENT_KIND_LABEL_KEY[option])}</option>)}
          </select>
        </div>
        <textarea
          className="document-textarea"
          placeholder={t("DocumentsView.textPlaceholder")}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={9}
          aria-label={t("DocumentsView.textPlaceholder")}
        />
        <div className="document-form-actions">
          <p className="empty-copy">{t("DocumentsView.privacyNote")}</p>
          <button className="primary-button" onClick={save} disabled={!text.trim() || saving}>
            {saving ? t("DocumentsView.saving") : t("DocumentsView.save")}
          </button>
        </div>
      </div>
    </section>}

    <section className="panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">{t("DocumentsView.library")}</p><h2>{t("DocumentsView.storedDocuments", { count: documents.length })}</h2></div>
      </div>
      {!loaded
        ? <p className="empty-copy">{t("DocumentsView.loading")}</p>
        : documents.length === 0
        ? <p className="empty-copy">{t("DocumentsView.emptyLibrary")}</p>
        : <div className="document-list">
            {documents.map((document) => <div className={`document-row${selectedId === document.id ? " is-selected" : ""}`} key={document.id}>
              <Page width={16} height={16}/>
              <div>
                <strong>{document.title}</strong>
                <span>{t(DOCUMENT_KIND_LABEL_KEY[document.kind] ?? "DocumentsView.kindOther")} · {t("DocumentsView.characters", { count: document.charCount.toLocaleString(currentLocale) })} · {dateFmt.format(new Date(document.createdAt))}</span>
              </div>
              <button className="soft-button" onClick={() => extract(document.id)} disabled={extracting}>
                {extracting && selectedId === document.id ? t("DocumentsView.reading") : t("DocumentsView.read")}
              </button>
              <button className="text-button quiet" onClick={() => remove(document.id)}>{t("DocumentsView.delete")}</button>
            </div>)}
          </div>}
    </section>

    {extraction && <section className="panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">{t("DocumentsView.reading_")}</p><h2>{t("DocumentsView.whatTheDocumentStates")}</h2></div>
        <span className="quiet-label">{t("DocumentsView.reviewBeforeActing")}</span>
      </div>
      {extraction.truncated && <p className="empty-copy infra-caveat">{t("DocumentsView.truncatedWarning")}</p>}
      <div className="extraction-grid">
        {extraction.fields.map((field) => <div className={`extraction-field${field.value ? "" : " is-absent"}`} key={field.label}>
          <p className="extraction-label">{field.label}</p>
          <p className="extraction-value">{field.value ?? t("DocumentsView.notStated")}</p>
          {field.sourceQuote && <p className="extraction-quote">&ldquo;{field.sourceQuote}&rdquo;</p>}
        </div>)}
      </div>
      {extraction.note && <p className="empty-copy">{extraction.note}</p>}
      <p className="empty-copy">{t("DocumentsView.extractionDisclaimer")}</p>
    </section>}
  </div>;
}

function OperationsView({ view, openConnections, dataMode }: { view: View; openConnections: () => void; dataMode: DataMode; providers: Provider[] }) {
  return <OperationsWorkspace view={view as "properties" | "leasing" | "maintenance" | "accounting"} sample={dataMode === "sample"} openConnections={openConnections}/>;
}

// Not gated behind a Provider connection like OperationsView's tabs — meters
// and bills are native Aval data (lib/infrastructure/), not synced from an
// upstream PMS/accounting system, so there's no "connect a source" story
// here. Sample mode shows the real derived rows from
// app/data/infrastructure-sample.ts; anything else is "no meters yet".
const UTILITY_LABEL_KEY: Record<UtilityType, string> = {
  electricity: "InfrastructureView.electricity",
  water: "InfrastructureView.water",
  gas: "InfrastructureView.gas",
};
const ASSET_CATEGORY_LABEL_KEY: Record<AssetCategory, string> = {
  hvac: "InfrastructureView.categoryHvac",
  plumbing: "InfrastructureView.categoryPlumbing",
  electrical: "InfrastructureView.categoryElectrical",
  envelope: "InfrastructureView.categoryEnvelope",
  safety: "InfrastructureView.categorySafety",
  conveyance: "InfrastructureView.categoryConveyance",
};

const DUE_STATUS_LABEL_KEY: Record<DueStatus, string> = {
  current: "InfrastructureView.statusCurrent",
  dueSoon: "InfrastructureView.statusDueSoon",
  overdue: "InfrastructureView.statusOverdue",
};

const ASSET_CONDITION_LABEL_KEY: Record<AssetCondition, string> = {
  good: "InfrastructureView.conditionGood",
  monitor: "InfrastructureView.conditionMonitor",
  plan: "InfrastructureView.conditionPlan",
  urgent: "InfrastructureView.conditionUrgent",
};

function InfrastructureView({ dataMode, onAddMeter }: { dataMode: DataMode; onAddMeter: () => void }) {
  const t = useTranslations();
  const currentLocale = useLocale();
  const isSample = dataMode === "sample";
  const [assetFilter, setAssetFilter] = useState<AssetCategory | "all">("all");

  const dueFmt = useMemo(() => new Intl.DateTimeFormat(currentLocale, { month: "short", day: "numeric", year: "numeric" }), [currentLocale]);
  const assets = assetFilter === "all" ? buildingAssets : buildingAssets.filter((asset) => asset.category === assetFilter);
  const annualReserve = formatMoney(totalAnnualReserveCents(), "USD");
  const overdueCompliance = complianceItems.filter((item) => item.status === "overdue").length;
  const overduePm = preventiveTasks.filter((task) => task.status === "overdue").length;
  const atRiskAssets = buildingAssets.filter((asset) => asset.condition === "plan" || asset.condition === "urgent").length;
  const forecastPeak = Math.max(...capitalForecast.map((year) => year.totalCents), 1);

  return <div className="view-wrap infra-view">
    <AppHeader title={t("InfrastructureView.infrastructure")} subtitle={t("InfrastructureView.infrastructureSubtitle")} actions={<button className="primary-button" onClick={onAddMeter}><Flash width={18} height={18}/>{t("InfrastructureView.addMeter")}</button>}/>
    {!isSample
      ? <section className="panel locked-panel" data-reveal><div className="locked-visual"><div className="locking-lines"><i/><i/><i/></div><span><Flash width={23} height={23}/></span></div><div><p className="eyebrow">{t("InfrastructureView.infrastructure")}</p><h2>{t("InfrastructureView.emptyDescription")}</h2><button className="primary-button" onClick={onAddMeter}>{t("InfrastructureView.addMeter")}<NavArrowRight width={17} height={17}/></button></div></section>
      : <>
        <section className="metric-grid">
          {infrastructureSummary.map((row) => <article className="metric-card" data-reveal key={row.utilityType}>
            <div className="metric-top"><span>{t(UTILITY_LABEL_KEY[row.utilityType])}</span><Flash width={18} height={18}/></div>
            <strong>{row.totalCostFormatted}</strong>
            <div className="metric-meta"><span className={row.usageVariancePct >= 0 ? "negative" : "positive"}>{row.usageVariancePct >= 0 ? "+" : ""}{row.usageVariancePct.toFixed(1)}%</span> {t("InfrastructureView.vsPriorPeriod")}</div>
            <p className="empty-copy">{row.totalUsage.toLocaleString(currentLocale)} {row.unitOfMeasure} · {t("InfrastructureView.metersCount", { count: row.meterCount })} · {t("InfrastructureView.billsCount", { count: row.billCount })}</p>
          </article>)}
          <article className="metric-card" data-reveal>
            <div className="metric-top"><span>{t("InfrastructureView.annualReserve")}</span><Tools width={18} height={18}/></div>
            <strong>{annualReserve}</strong>
            <div className="metric-meta">{t("InfrastructureView.acrossTrackedAssets", { count: buildingAssets.length })}</div>
            <p className="empty-copy">{t("InfrastructureView.reserveExplainer")}</p>
          </article>
          <article className="metric-card" data-reveal>
            <div className="metric-top"><span>{t("InfrastructureView.needsAttention")}</span><WarningTriangle width={18} height={18}/></div>
            <strong>{overdueCompliance + overduePm}</strong>
            <div className="metric-meta">{t("InfrastructureView.overdueBreakdown", { compliance: overdueCompliance, tasks: overduePm })}</div>
            <p className="empty-copy">{t("InfrastructureView.assetsNearingEndOfLife", { count: atRiskAssets })}</p>
          </article>
        </section>

        <section className="panel" data-reveal>
          <div className="panel-heading">
            <div><p className="eyebrow">{t("InfrastructureView.assetRegister")}</p><h2>{t("InfrastructureView.equipmentAndServiceLife")}</h2></div>
            <div className="segmented text infra-filter">
              <button className={assetFilter === "all" ? "active" : ""} onClick={() => setAssetFilter("all")}>{t("InfrastructureView.filterAll")}</button>
              {(Object.keys(ASSET_CATEGORY_LABEL_KEY) as AssetCategory[]).map((category) => <button key={category} className={assetFilter === category ? "active" : ""} onClick={() => setAssetFilter(category)}>{t(ASSET_CATEGORY_LABEL_KEY[category])}</button>)}
            </div>
          </div>
          <div className="infra-table-scroll">
            <table className="infra-table">
              <thead><tr>
                <th>{t("InfrastructureView.colAsset")}</th>
                <th>{t("InfrastructureView.colProperty")}</th>
                <th>{t("InfrastructureView.colAge")}</th>
                <th>{t("InfrastructureView.colLifeUsed")}</th>
                <th>{t("InfrastructureView.colReplace")}</th>
                <th>{t("InfrastructureView.colCost")}</th>
                <th>{t("InfrastructureView.colReserve")}</th>
              </tr></thead>
              <tbody>
                {assets.map((asset) => <tr key={asset.id}>
                  <td><strong>{t(asset.labelKey)}</strong><small>{t(ASSET_CATEGORY_LABEL_KEY[asset.category])} · {t(asset.locationKey)}</small></td>
                  <td>{t(asset.propertyKey)}</td>
                  <td>{t("InfrastructureView.yearsOf", { age: asset.ageYears, life: asset.expectedLifeYears })}</td>
                  <td>
                    <div className="life-bar" title={`${asset.lifeConsumedPct.toFixed(0)}%`}><i style={{ width: `${Math.min(asset.lifeConsumedPct, 100)}%` }} data-condition={asset.condition}/></div>
                    <small className={`condition-label ${asset.condition}`}>{t(ASSET_CONDITION_LABEL_KEY[asset.condition])}</small>
                  </td>
                  <td>{asset.replacementYear}</td>
                  <td>{asset.replacementCostFormatted}</td>
                  <td>{asset.annualReserveFormatted}<small>{t("InfrastructureView.perYear")}</small></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {assets.length === 0 && <p className="empty-copy">{t("InfrastructureView.noAssetsInCategory")}</p>}
        </section>

        <section className="overview-grid" data-reveal>
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">{t("InfrastructureView.compliance")}</p><h2>{t("InfrastructureView.inspectionsAndCertificates")}</h2></div><ShieldCheck width={22} height={22}/></div>
            {complianceItems.map((item) => <div className="source-row" key={item.id}>
              <div><strong>{t(item.labelKey)}</strong><span>{t(item.authorityKey)} · {t(item.propertyKey)}</span></div>
              <div className="infra-due">
                <span className={`status-pill ${item.status}`}>{t(DUE_STATUS_LABEL_KEY[item.status])}</span>
                <small>{item.status === "overdue" ? t("InfrastructureView.overdueByDays", { days: Math.abs(item.daysUntilDue) }) : t("InfrastructureView.dueOn", { date: dueFmt.format(item.dueDate) })}</small>
              </div>
            </div>)}
          </article>
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">{t("InfrastructureView.preventiveMaintenance")}</p><h2>{t("InfrastructureView.recurringWork")}</h2></div><Tools width={22} height={22}/></div>
            {preventiveTasks.map((task) => <div className="source-row" key={task.id}>
              <div><strong>{t(task.labelKey)}</strong><span>{t(ASSET_CATEGORY_LABEL_KEY[task.category])} · {t("InfrastructureView.everyDays", { days: task.cadenceDays })}</span></div>
              <div className="infra-due">
                <span className={`status-pill ${task.status}`}>{t(DUE_STATUS_LABEL_KEY[task.status])}</span>
                <small>{task.daysUntilDue < 0 ? t("InfrastructureView.overdueByDays", { days: Math.abs(task.daysUntilDue) }) : t("InfrastructureView.inDays", { days: task.daysUntilDue })}</small>
              </div>
            </div>)}
          </article>
        </section>

        <section className="panel" data-reveal>
          <div className="panel-heading"><div><p className="eyebrow">{t("InfrastructureView.capitalPlanning")}</p><h2>{t("InfrastructureView.replacementForecast")}</h2></div><span className="quiet-label">{t("InfrastructureView.tenYearHorizon")}</span></div>
          <div className="capital-forecast">
            {capitalForecast.map((year) => <div className="capital-year" key={year.year}>
              <div className="capital-bar-track"><i style={{ height: `${(year.totalCents / forecastPeak) * 100}%` }} data-empty={year.totalCents === 0 ? "true" : undefined}/></div>
              <strong>{year.totalCents === 0 ? "—" : year.totalFormatted}</strong>
              <span>{year.year}</span>
            </div>)}
          </div>
          <p className="empty-copy">{t("InfrastructureView.forecastExplainer")}</p>
        </section>

        <section className="panel" data-reveal>
          <div className="panel-heading"><div><p className="eyebrow">{t("InfrastructureView.plumbingLoad")}</p><h2>{t("InfrastructureView.fixtureUnitLoad")}</h2></div><span className="quiet-label">{t("InfrastructureView.wsfuTotal", { units: fixtureLoad.totalUnits })}</span></div>
          <div className="fixture-grid">
            {fixtureLoad.fixtures.map((fixture) => <div className="fixture-row" key={fixture.type}>
              <span>{t(`InfrastructureView.fixture_${fixture.type}`)}</span>
              <b>{fixture.count}</b>
              <small>{t("InfrastructureView.wsfuEach", { units: fixture.unitsEach })}</small>
              <strong>{fixture.unitsTotal.toFixed(1)}</strong>
            </div>)}
          </div>
          <p className={`empty-copy${fixtureLoad.beyondTableRange ? " infra-caveat" : ""}`}>
            {fixtureLoad.beyondTableRange
              ? t("InfrastructureView.pipeSizeBeyondTable", { units: fixtureLoad.totalUnits, ceiling: FIXTURE_UNIT_TABLE_CEILING })
              : t("InfrastructureView.pipeSizeEstimate", { size: fixtureLoad.estimatedPipeSizeInches })}
          </p>
        </section>
      </>}
  </div>;
}

/** Where a chosen agent's answers land — fixed, since every persona routes the same way. */
const SETUP_OUTPUT_NODES: { labelKey: string; icon: IconComponent }[] = [
  { labelKey: "SetupView.outputAskAval", icon: ChatLines },
  { labelKey: "SetupView.outputDrafts", icon: Page },
  { labelKey: "SetupView.outputTaskBoard", icon: TaskList },
];

interface TaughtPreference { topic: string; statement: string; label: string; source: string }
interface PreferenceOption { topic: string; statements: { statement: string; label: string }[] }

/** Label keys for the fixed preference taxonomy, so the picker reads as English/Spanish, not as tags. */
const PREFERENCE_TOPIC_LABEL_KEY: Record<string, string> = {
  vendor_selection: "SetupView.topicVendorSelection",
  communication_channel: "SetupView.topicCommunicationChannel",
  reporting_style: "SetupView.topicReportingStyle",
  approval_threshold: "SetupView.topicApprovalThreshold",
};

/**
 * Aval Setup — the agent module's control panel: which agent sits at the
 * center, what it can reach, and what it has been taught.
 *
 * Two things here genuinely change how the assistant behaves rather than
 * just describing it:
 *   - the center agent's tool grant (PERSONA_TOOL_ACCESS), which decides
 *     which data tools the loop may call at all; and
 *   - taught preferences, which are read back into every future Ask Aval
 *     system prompt by getPreferenceContext(). Teaching here writes the same
 *     rows the assistant learns from mid-conversation corrections.
 */
function SetupView({ dataMode, openConnections }: { dataMode: DataMode; openConnections: () => void }) {
  const t = useTranslations();
  const { notify } = useExperience();
  const [selected, setSelected] = useState<PersonaId>("general");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [taught, setTaught] = useState<TaughtPreference[]>([]);
  const [options, setOptions] = useState<PreferenceOption[]>([]);
  const [teaching, setTeaching] = useState<string | null>(null);
  const [busyTopic, setBusyTopic] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftState, setDraftState] = useState<"idle" | "saving" | "noMatch">("idle");
  const [suggestions, setSuggestions] = useState<{ topic: string; text: string }[]>([]);
  const [suggestionSeed, setSuggestionSeed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/agents/default").then((r) => (r.ok ? r.json() as Promise<{ defaultPersonaId?: string | null }> : null)).catch(() => null),
      fetch("/api/agents/memory").then((r) => (r.ok ? r.json() as Promise<{ taught: TaughtPreference[]; options: PreferenceOption[]; suggestions: { topic: string; text: string }[] }> : null)).catch(() => null),
    ]).then(([agent, memory]) => {
      if (cancelled) return;
      const saved = agent?.defaultPersonaId;
      if (saved && PERSONA_IDS.includes(saved as PersonaId)) setSelected(saved as PersonaId);
      if (memory) { setTaught(memory.taught); setOptions(memory.options); setSuggestions(memory.suggestions ?? []); }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const preset = PERSONA_PRESETS[selected];
  const access = PERSONA_TOOL_ACCESS[selected];
  const reachesEverything = access === null;
  const reachable = useMemo(() => new Set(access ?? DATA_SOURCE_NODES.map((node) => node.tool)), [access]);
  const taughtByTopic = useMemo(() => new Map(taught.map((row) => [row.topic, row])), [taught]);

  async function choose(next: PersonaId) {
    if (next === selected) return;
    const previous = selected;
    setSelected(next);
    setSaving(true);
    try {
      const response = await fetch("/api/agents/default", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaId: next }) });
      if (!response.ok) throw new Error(String(response.status));
      notify(t("SetupView.savedTitle"), t("SetupView.savedDetail", { agent: t(PERSONA_PRESETS[next].labelKey) }));
    } catch {
      setSelected(previous);
      notify(t("SetupView.saveFailedTitle"), t("SetupView.saveFailedDetail"));
    } finally { setSaving(false); }
  }

  async function teach(topic: string, statement: string) {
    setBusyTopic(topic);
    try {
      const response = await fetch("/api/agents/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, statement }) });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { taught: TaughtPreference[]; suggestions: { topic: string; text: string }[] };
      setTaught(body.taught);
      setSuggestions(body.suggestions ?? []);
      setTeaching(null);
      notify(t("SetupView.taughtTitle"), t("SetupView.taughtDetail"));
    } catch {
      notify(t("SetupView.teachFailedTitle"), t("SetupView.teachFailedDetail"));
    } finally { setBusyTopic(null); }
  }

  /**
   * Teaches from a typed sentence. The server classifies it into the fixed
   * taxonomy and stores only the resulting tag — the sentence itself is never
   * persisted. A 422 means it couldn't be placed confidently, which is shown
   * as "pick from the list" rather than guessed at.
   */
  async function teachFromText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraftState("saving");
    try {
      const response = await fetch("/api/agents/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: trimmed }) });
      if (response.status === 422) { setDraftState("noMatch"); return; }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { taught: TaughtPreference[]; suggestions: { topic: string; text: string }[]; matched?: { topic: string; statement: string } };
      setTaught(body.taught);
      setSuggestions(body.suggestions ?? []);
      setDraft("");
      setDraftState("idle");
      const label = body.taught.find((row) => row.topic === body.matched?.topic)?.label ?? "";
      notify(t("SetupView.taughtTitle"), label || t("SetupView.taughtDetail"));
    } catch {
      setDraftState("idle");
      notify(t("SetupView.teachFailedTitle"), t("SetupView.teachFailedDetail"));
    }
  }

  async function forget(topic: string) {
    setBusyTopic(topic);
    try {
      const response = await fetch(`/api/agents/memory?topic=${encodeURIComponent(topic)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { taught: TaughtPreference[]; suggestions: { topic: string; text: string }[] };
      setTaught(body.taught);
      setSuggestions(body.suggestions ?? []);
    } catch {
      notify(t("SetupView.teachFailedTitle"), t("SetupView.teachFailedDetail"));
    } finally { setBusyTopic(null); }
  }

  return <div className="view-wrap setup-view">
    <AppHeader
      title={t("SetupView.setup")}
      subtitle={t("SetupView.setupSubtitle")}
      actions={<button className="soft-button" onClick={openConnections}><NetworkLeft width={17} height={17}/>{t("SetupView.connectASource")}</button>}
    />

    <section className="panel setup-panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">{t("SetupView.wiring")}</p><h2>{t("SetupView.whatThisAgentCanReach")}</h2></div>
        <span className="quiet-label">{reachesEverything ? t("SetupView.allSources") : t("SetupView.sourcesOfTotal", { count: reachable.size, total: DATA_SOURCE_NODES.length })}</span>
      </div>

      <div className="setup-diagram">
        <div className="setup-column">
          <p className="setup-column-label">{t("SetupView.dataSources")}</p>
          {DATA_SOURCE_NODES.map((node) => {
            const on = reachable.has(node.tool);
            return <div className={`setup-node${on ? "" : " is-off"}`} key={node.tool}>
              <Database width={15} height={15}/>
              <span>{t(node.labelKey)}</span>
              {!on && <small>{t("SetupView.notAvailable")}</small>}
            </div>;
          })}
          <button type="button" className="setup-node setup-node-action" onClick={openConnections}>
            <Plus width={15} height={15}/><span>{t("SetupView.connectAPms")}</span>
          </button>
        </div>

        <div className="setup-rails" aria-hidden="true"/>

        <div className="setup-center">
          <div className={`setup-agent-node${saving ? " is-saving" : ""}`}>
            <AvalAgentAvatar personaId={preset.id} shape={preset.shape} theme={preset.theme} icon={preset.icon} size={56} label={t(preset.labelKey)}/>
            <strong>{t(preset.labelKey)}</strong>
            <small>{t("SetupView.workspaceDefault")}</small>
            <span className="setup-memory-count">{t("SetupView.factsRemembered", { count: taught.length })}</span>
          </div>
        </div>

        <div className="setup-rails is-out" aria-hidden="true"/>

        <div className="setup-column">
          <p className="setup-column-label">{t("SetupView.whereAnswersGo")}</p>
          {SETUP_OUTPUT_NODES.map((node) => { const Icon = node.icon; return <div className="setup-node" key={node.labelKey}>
            <Icon width={15} height={15}/><span>{t(node.labelKey)}</span>
          </div>; })}
        </div>
      </div>

      {dataMode !== "sample" && <p className="empty-copy">{t("SetupView.connectSourcesNote")}</p>}
    </section>

    <section className="panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">{t("SetupView.memory")}</p><h2>{t("SetupView.whatAvalRemembers")}</h2></div>
        <span className="quiet-label">{t("SetupView.appliesEverywhere")}</span>
      </div>

      <div className="teach-box">
        <div className="teach-input-row">
          <input
            type="text"
            className="teach-input"
            placeholder={t("SetupView.teachPlaceholder")}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); if (draftState === "noMatch") setDraftState("idle"); }}
            onKeyDown={(event) => { if (event.key === "Enter") teachFromText(draft); }}
            disabled={draftState === "saving" || !loaded}
            aria-label={t("SetupView.teachPlaceholder")}
          />
          <button type="button" className="primary-button" onClick={() => teachFromText(draft)} disabled={!draft.trim() || draftState === "saving" || !loaded}>
            {draftState === "saving" ? t("SetupView.saving") : t("SetupView.teachAval")}
          </button>
        </div>
        {draftState === "noMatch"
          ? <p className="teach-hint is-warning">{t("SetupView.noMatchHint")}</p>
          : <p className="teach-hint">{t("SetupView.teachHint")}</p>}

        {suggestions.length > 0 && <div className="teach-suggestions">
          <div className="teach-suggestions-head">
            <span>{t("SetupView.notSureWhatToTeach")}</span>
            <button type="button" className="text-button" onClick={() => setSuggestionSeed((seed) => seed + 1)}>
              <Refresh width={13} height={13}/>{t("SetupView.refresh")}
            </button>
          </div>
          <div className="teach-suggestion-chips">
            {/* One rotating window over the pool, so Refresh always changes
                what's on screen instead of reshuffling into the same three. */}
            {Array.from({ length: Math.min(3, suggestions.length) }, (_, offset) => suggestions[(suggestionSeed * 3 + offset) % suggestions.length]).map((suggestion, index) => (
              <button type="button" className="teach-chip" key={`${suggestion.topic}-${index}`} onClick={() => { setDraft(suggestion.text); setDraftState("idle"); }}>
                {suggestion.text}
              </button>
            ))}
          </div>
        </div>}
      </div>

      <div className="memory-grid">
        {options.map((option) => {
          const current = taughtByTopic.get(option.topic);
          const isOpen = teaching === option.topic;
          const busy = busyTopic === option.topic;
          return <article className={`memory-card${current ? " is-taught" : ""}`} key={option.topic}>
            <div className="memory-card-head">
              <div>
                <strong>{t(PREFERENCE_TOPIC_LABEL_KEY[option.topic] ?? option.topic)}</strong>
                <small>{current ? current.label : t("SetupView.nothingTaughtYet")}</small>
              </div>
              {current
                ? <span className={`status-pill ${current.source === "ask_aval" ? "" : "optional"}`}>{current.source === "ask_aval" ? t("SetupView.learnedFromChat") : t("SetupView.setHere")}</span>
                : null}
            </div>
            <div className="memory-card-actions">
              <button type="button" className="text-button" disabled={busy || !loaded} onClick={() => setTeaching(isOpen ? null : option.topic)}>
                {current ? t("SetupView.change") : t("SetupView.teachAval")}
                <NavArrowDown width={14} height={14}/>
              </button>
              {current && <button type="button" className="text-button quiet" disabled={busy} onClick={() => forget(option.topic)}>{t("SetupView.forget")}</button>}
            </div>
            {isOpen && <div className="memory-options">
              {option.statements.map((choice) => <button
                type="button"
                key={choice.statement}
                className={`memory-option${current?.statement === choice.statement ? " is-selected" : ""}`}
                disabled={busy}
                onClick={() => teach(option.topic, choice.statement)}
              >
                {current?.statement === choice.statement && <Check width={13} height={13}/>}
                <span>{choice.label}</span>
              </button>)}
            </div>}
          </article>;
        })}
      </div>

      <p className="empty-copy">{t("SetupView.memoryExplainer")}</p>
    </section>

    <section className="panel" data-reveal>
      <div className="panel-heading">
        <div><p className="eyebrow">{t("SetupView.swapAgent")}</p><h2>{t("SetupView.chooseTheCenterAgent")}</h2></div>
        {saving && <span className="quiet-label">{t("SetupView.saving")}</span>}
      </div>
      <div className="setup-agent-grid">
        {PERSONA_IDS.map((id) => {
          const option = PERSONA_PRESETS[id];
          const optionAccess = PERSONA_TOOL_ACCESS[id];
          const isSelected = id === selected;
          return <button type="button" className={`setup-agent-card${isSelected ? " is-selected" : ""}`} key={id} onClick={() => choose(id)} disabled={saving || !loaded} aria-pressed={isSelected}>
            <AvalAgentAvatar personaId={option.id} shape={option.shape} theme={option.theme} icon={option.icon} size={38} selected={isSelected} interactive/>
            <span>
              <strong>{t(option.labelKey)}</strong>
              <small>{optionAccess === null ? t("SetupView.allSources") : t("SetupView.sourcesOfTotal", { count: optionAccess.length, total: DATA_SOURCE_NODES.length })}</small>
            </span>
            {isSelected && <Check width={16} height={16}/>}
          </button>;
        })}
      </div>
      <p className="empty-copy">{t("SetupView.swapExplainer")}</p>
    </section>
  </div>;
}

function SettingsView({ openConnections, displayName, email }: { openConnections: () => void; displayName: string; email: string }) {
  const t = useTranslations();
  return <SettingsModule header={<AppHeader title={t("SettingsView.settings")} subtitle={t("SettingsModule.subtitle")}/>} openConnections={openConnections} displayName={displayName} email={email}/>;
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

const UTILITY_TYPE_OPTIONS: UtilityType[] = ["electricity", "water", "gas"];
const DEFAULT_UNIT_BY_UTILITY: Record<UtilityType, string> = { electricity: "kWh", water: "gal", gas: "therm" };

/**
 * Creates a real utility_meters row via POST /api/infrastructure/meters.
 * Sample mode's KPI tiles (app/data/infrastructure-sample.ts) won't reflect
 * a newly-added meter — the same is true of every "Connect data" flow
 * elsewhere in this file, where sample-mode tiles are driven by
 * dataMode, not by what's actually connected/created.
 */
function AddMeterDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const { notify } = useExperience();
  const [propertyLabel, setPropertyLabel] = useState("");
  const [utilityType, setUtilityType] = useState<UtilityType>("electricity");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = propertyLabel.trim();
    if (!label || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/infrastructure/meters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utilityType, propertyLabel: label, unitOfMeasure: DEFAULT_UNIT_BY_UTILITY[utilityType] }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        notify(t("InfrastructureView.addMeter"), label);
        onClose();
      } else {
        setError(data.error || t("InfrastructureView.addMeterError"));
      }
    } catch {
      setError(t("InfrastructureView.addMeterError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="small-dialog">
          <div className="dialog-top">
            <Dialog.Title>{t("InfrastructureView.addMeter")}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20} /></Dialog.Close>
          </div>
          <form className="aval-draft-panel" onSubmit={submit}>
            <input value={propertyLabel} onChange={(event) => setPropertyLabel(event.target.value)} placeholder={t("InfrastructureView.propertyLabelPlaceholder")} autoFocus />
            <div className="aval-draft-panel-row">
              <select value={utilityType} onChange={(event) => setUtilityType(event.target.value as UtilityType)}>
                {UTILITY_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{t(UTILITY_LABEL_KEY[option])}</option>)}
              </select>
              <button type="submit" className="primary-button" disabled={!propertyLabel.trim() || submitting}>
                <NavArrowRight width={16} height={16} />{t("InfrastructureView.addMeter")}
              </button>
            </div>
            {error && <p className="aval-agent-create-error">{error}</p>}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DesktopApp({ authMode, displayName, email }: { authMode: AuthMode; displayName: string; email: string }) {
  // Everyone signed out shares one workspace, so anything saved here is
  // visible to the next visitor. Surfaces that store content say so.
  const isGuest = authMode === "guest";
  const { market, setMarket, theme, setTheme, sounds, setSounds, celebrate, notify } = useExperience();
  const t = useTranslations();
  const currentLocale = useLocale();
  const { jobs: draftJobs, createJob: createDraftJob, pauseJob: pauseDraftJob, resumeJob: resumeDraftJob, retryJob: retryDraftJob, sendJob: sendDraftJob } = useDraftJobs(currentLocale);
  const router = useRouter();
  const pathname = usePathname();
  const switchLocale = (nextLocale: "en" | "es-mx") => router.replace(pathname, { locale: nextLocale }); const [view, setView] = useState<View>(() => { if (typeof window === "undefined") return "overview"; const requested = new URLSearchParams(window.location.search).get("view") as View | null; return requested && navGroups.some((group) => group.items.some((item) => item.id === requested)) ? requested : "overview"; }); const [dataMode] = useState<DataMode>(() => { if (typeof window === "undefined") return isGuest ? "sample" : "live"; const requested = new URLSearchParams(window.location.search).get("data"); return requested === "empty" || requested === "live" || requested === "sample" ? requested : isGuest ? "sample" : "live"; }); const [providers, setProviders] = useState<Provider[]>(fallbackProviders); const [loading, setLoading] = useState(true); const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null); const [addMeterOpen, setAddMeterOpen] = useState(false); const [collapsed, setCollapsed] = useState(false); const [profile, setProfile] = useState(false); const [notifications, setNotifications] = useState(false); const [notificationItems, setNotificationItems] = useState<NotificationItem[]>(sampleData.notifications.items); const [pendingTarget, setPendingTarget] = useState<NotificationTarget | null>(null); const [targetToken, setTargetToken] = useState(0); const unreadCount = notificationItems.filter((item) => !item.read).length; const accountingProviderId = market === "latam" ? "contpaqi" : "quickbooks";
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
  // Fire-and-forget: persists the decision so Ask Aval can learn from real
  // usage over time (lib/ask-aval/usage-patterns.ts). Never blocks the UI
  // and never surfaces its own failure — reviewStatuses above is still the
  // source of truth for what the user sees right now.
  const recordInsightDecision = (insightId: string, decision: "approved" | "denied" | "sent") => {
    fetch("/api/insights/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ insightId, decision }) }).catch(() => {});
  };
  // Single source of truth for every review decision — called from both
  // Overview's insight queue and the Review Center, so a decision made in
  // either place is reflected identically in the other.
  const approveInsight = (insight: InsightCandidate) => {
    setReviewStatuses((current) => ({ ...current, [insight.id]: "approved" }));
    recordInsightDecision(insight.id, "approved");
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
    recordInsightDecision(insight.id, "denied");
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
    recordInsightDecision(insight.id, "sent");
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
  return <main className={`app-shell ${collapsed ? "sidebar-is-collapsed" : ""}`}><aside className="sidebar"><div className="brand-lockup"><span className="brand-symbol">a</span><div><strong>aval</strong><small>{t("DesktopApp.propertyOperations")}</small></div><button className="icon-button sidebar-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={t(collapsed ? "DesktopApp.expandSidebar" : "DesktopApp.collapseSidebar")} aria-expanded={!collapsed}><ViewColumns3 width={18} height={18}/></button></div><nav>{navGroups.map((group) => <div className="nav-group" key={group.labelKey}><p>{t(group.labelKey)}</p>{group.items.map((item) => { const Icon = item.icon; const count = navCounts[item.id] ?? item.count; return <button className={view === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} key={item.id} title={t(item.labelKey)}><Icon width={20} height={20}/><span>{t(item.labelKey)}</span>{Boolean(count) && <b>{count}</b>}{view === item.id && <NavArrowRight className="nav-chevron" width={16} height={16}/>}</button>; })}</div>)}</nav><button className="workspace-card" aria-expanded={profile} onClick={() => { setCollapsed(false); setProfile(!profile); }}><ProfileAvatar name={displayName} size={36}/><span><strong>{displayName}</strong><small>{email}</small></span><span className="icon-button"><NavArrowDown width={16} height={16}/></span></button>{profile && <div className="profile-menu"><div><ProfileAvatar name={displayName} size={36}/><span><strong>{displayName}</strong><small>{email}</small></span></div><button onClick={() => setActiveView("settings")}><Settings width={17} height={17}/>{t("DesktopApp.profileSettings")}</button><button onClick={() => switchLocale(currentLocale === "en" ? "es-mx" : "en")}><Language width={17} height={17}/>{currentLocale === "en" ? "Español (México)" : "English"}</button><button onClick={() => setMarket(market === "us" ? "latam" : "us")}><Globe width={17} height={17}/>{market === "us" ? t("DesktopApp.marketUnitedStates") : t("DesktopApp.marketLatam")}</button><button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <HalfMoon width={17} height={17}/> : <SunLight width={17} height={17}/>} {theme === "light" ? t("DesktopApp.darkMode") : t("DesktopApp.lightMode")}</button><button onClick={() => setSounds(!sounds)}>{sounds ? <SoundHigh width={17} height={17}/> : <SoundOff width={17} height={17}/>} {sounds ? t("DesktopApp.soundsOn") : t("DesktopApp.soundsOff")}</button>{isGuest && <a href="?signin=1" className="profile-menu-signin"><Key width={17} height={17}/>{t("DesktopApp.signIn")}</a>}
      {authMode === "password"
        ? <button type="button" onClick={signOutOfPasswordAccount}><LogOut width={17} height={17}/>{t("DesktopApp.signOut")}</button>
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- external platform sign-out route, not part of this app router
        : <a href="/signout-with-chatgpt?return_to=/"><LogOut width={17} height={17}/>{t("DesktopApp.signOut")}</a>}
      </div>}</aside><section className="content-shell" aria-label={t(titleKey)}><DesktopServiceBar/>{(view === "calendar" || view === "projects" || view === "teams") && <PlanningWorkspace key={view} view={view} isGuest={isGuest}/>} {view === "overview" && <Overview displayName={displayName} openConnections={openConnections} dataMode={dataMode} providers={providers} pendingTarget={pendingTarget} targetToken={targetToken} reviewStatuses={reviewStatuses} sentReceipts={sentReceipts} onApprove={approveInsight} onDeny={denyInsight} onSendReminders={sendReminderBatch} onCreateDraft={createDraftJob}/>} {view === "tasks" && <TasksView isGuest={isGuest} draftJobs={draftJobs} onCreateDraft={createDraftJob} onPauseDraft={pauseDraftJob} onResumeDraft={resumeDraftJob} onRetryDraft={retryDraftJob} onSendDraft={sendDraftJob}/>} {view === "reviewCenter" && <ReviewCenterView reviewStatuses={reviewStatuses} sentReceipts={sentReceipts} onApprove={approveInsight} onDeny={denyInsight} onSendReminders={sendReminderBatch}/>} {view === "inbox" && <InboxView pendingTarget={pendingTarget} targetToken={targetToken}/>} {view === "connections" && <ConnectionsView providers={providers} loading={loading} onOpen={openProvider}/>} {view === "settings" && <SettingsView openConnections={openConnections} displayName={displayName} email={email}/>} {view === "infrastructure" && <InfrastructureView dataMode={dataMode} onAddMeter={() => setAddMeterOpen(true)}/>} {view === "setup" && <SetupView dataMode={dataMode} openConnections={openConnections}/>} {view === "documents" && <DocumentsView isGuest={isGuest}/>} {(["properties", "leasing", "maintenance", "accounting"] as View[]).includes(view) && <OperationsView view={view} openConnections={openConnections} dataMode={dataMode} providers={providers}/>}</section>{selectedProvider && <ConnectionDialog provider={selectedProvider} onClose={() => setSelectedProvider(null)} onRefresh={loadProviders}/>}{addMeterOpen && <AddMeterDialog onClose={() => setAddMeterOpen(false)}/>}<Dialog.Root open={notifications} onOpenChange={setNotifications}><Dialog.Portal><Dialog.Overlay className="dialog-overlay subtle"/><Dialog.Content className="notification-drawer"><div className="drawer-heading"><div><p className="eyebrow">{t("DesktopApp.liveWorkspace")}</p><Dialog.Title>{t("DesktopApp.notifications")}</Dialog.Title></div><Dialog.Close className="icon-button" aria-label={t("Overview.close")}><Xmark width={20} height={20}/></Dialog.Close></div><div className="notification-list">{notificationItems.map((item) => <button key={item.id} className={item.read ? "" : "unread"} onClick={() => openNotification(item)}><BrandMark provider={resolveNotificationProvider(item)} small/><span><strong>{t(item.titleKey)}</strong><small>{t(item.detailKey, item.detailParams)}</small></span><span className="notif-trailing">{!item.read && <i className="unread-dot"/>}<time>{formatMinutesAgo(item.minutesAgo, currentLocale)}</time></span></button>)}</div><button className="wide-button" onClick={() => setNotificationItems((current) => current.map((item) => ({ ...item, read: true })))}><Check width={17} height={17}/>{unreadCount ? t("DesktopApp.markAllAsRead") : t("DesktopApp.allCaughtUp")}</button></Dialog.Content></Dialog.Portal></Dialog.Root><AvalAssistant view={view} onCreateDraft={createDraftJob}/></main>;
}

export function AvalDashboard({ authMode, displayName, email }: { authMode: AuthMode; displayName: string; email: string }) { return <ExperienceProvider><AppearanceProvider key={`${authMode}:${email}`} isGuest={authMode === "guest"}><DesktopApp authMode={authMode} displayName={displayName} email={email}/></AppearanceProvider></ExperienceProvider>; }
