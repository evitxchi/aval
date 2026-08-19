export type ProviderId =
  | "quickbooks"
  | "xero"
  | "appfolio"
  | "buildium"
  | "whatsapp"
  | "apple_messages"
  | "slack"
  | "notion"
  | "outlook"
  | "gmail"
  | "telegram"
  | "twilio"
  | "granola";

export type IntegrationProvider = {
  id: ProviderId;
  title: string;
  category: "Accounting" | "Leasing & PMS" | "Communication" | "Knowledge";
  description: string;
  authMode: "oauth2" | "credentials" | "bot_token" | "api_key" | "msp";
  permissions: string[];
  credentialFields?: { key: string; label: string; secret?: boolean }[];
  env: string[];
  webhook: boolean;
  readOnly: boolean;
  note: string;
};

export const integrationCatalog: IntegrationProvider[] = [
  {
    id: "quickbooks",
    title: "QuickBooks Online",
    category: "Accounting",
    description: "Read receivables, payments, invoices, chart of accounts, and operating reports.",
    authMode: "oauth2",
    permissions: ["com.intuit.quickbooks.accounting"],
    env: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
    webhook: true,
    readOnly: true,
    note: "OAuth 2.0; Aval requests an accounting connection and only issues read calls.",
  },
  {
    id: "xero",
    title: "Xero",
    category: "Accounting",
    description: "Read invoices, payments, bank transactions, contacts, and financial reports.",
    authMode: "oauth2",
    permissions: ["openid", "profile", "email", "offline_access", "accounting.invoices.read", "accounting.payments.read", "accounting.banktransactions.read", "accounting.contacts.read", "accounting.settings.read", "accounting.reports.profitandloss.read", "accounting.reports.balancesheet.read"],
    env: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
    webhook: false,
    readOnly: true,
    note: "Uses Xero's granular read scopes introduced in 2026.",
  },
  {
    id: "appfolio",
    title: "AppFolio",
    category: "Leasing & PMS",
    description: "Normalize inquiries, showings, rental applications, leases, tenants, and ledgers.",
    authMode: "credentials",
    permissions: ["Rental applications", "Showings", "Tenants", "Tenant ledgers"],
    credentialFields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client secret", secret: true },
      { key: "database", label: "Database name" },
    ],
    env: [],
    webhook: false,
    readOnly: true,
    note: "Availability depends on the AppFolio Stack partnership and the customer's enabled API products.",
  },
  {
    id: "buildium",
    title: "Buildium",
    category: "Leasing & PMS",
    description: "Read rentals, applicants, leases, showings, work orders, and general-ledger data.",
    authMode: "credentials",
    permissions: ["Rentals", "Applicants", "Leases", "Tasks", "Accounting"],
    credentialFields: [
      { key: "clientId", label: "Buildium client ID" },
      { key: "clientSecret", label: "Buildium client secret", secret: true },
    ],
    env: [],
    webhook: false,
    readOnly: true,
    note: "Server-to-server authentication using Buildium's required client headers.",
  },
  {
    id: "whatsapp",
    title: "WhatsApp Business",
    category: "Communication",
    description: "Receive tenant messages and send approved replies through Meta's Cloud API.",
    authMode: "credentials",
    permissions: ["whatsapp_business_messaging", "whatsapp_business_management"],
    credentialFields: [
      { key: "businessAccountId", label: "WhatsApp Business Account ID" },
      { key: "phoneNumberId", label: "Phone number ID" },
      { key: "accessToken", label: "Permanent system-user access token", secret: true },
    ],
    env: ["META_WHATSAPP_APP_SECRET", "META_WHATSAPP_VERIFY_TOKEN", "META_GRAPH_API_VERSION"],
    webhook: true,
    readOnly: false,
    note: "Inbound events are signature-verified before they enter the message queue.",
  },
  {
    id: "apple_messages",
    title: "Apple Messages",
    category: "Communication",
    description: "Route Apple Messages for Business conversations through an approved messaging provider.",
    authMode: "msp",
    permissions: ["Business registration", "Messaging Service Provider routing"],
    credentialFields: [
      { key: "provider", label: "Messaging Service Provider" },
      { key: "webhookSecret", label: "Webhook signing secret", secret: true },
    ],
    env: [],
    webhook: true,
    readOnly: false,
    note: "Apple does not offer direct iMessage OAuth. This adapter requires Apple approval and an MSP.",
  },
  {
    id: "slack",
    title: "Slack",
    category: "Communication",
    description: "Read selected channels, route approvals, and post task updates.",
    authMode: "oauth2",
    permissions: ["channels:history", "channels:read", "chat:write", "users:read"],
    env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"],
    webhook: true,
    readOnly: false,
    note: "Workspace admins choose channels during OAuth; events are acknowledged before processing.",
  },
  {
    id: "notion",
    title: "Notion",
    category: "Knowledge",
    description: "Index only the pages and databases explicitly shared with Aval.",
    authMode: "oauth2",
    permissions: ["User-selected pages and databases"],
    env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
    webhook: false,
    readOnly: true,
    note: "Notion's authorization screen controls the exact workspace content Aval can access.",
  },
  {
    id: "outlook",
    title: "Outlook",
    category: "Communication",
    description: "Read selected mail and calendar context through Microsoft Graph.",
    authMode: "oauth2",
    permissions: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"],
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    webhook: false,
    readOnly: true,
    note: "Delegated Microsoft Graph access; no mailbox-wide app permission is requested.",
  },
  {
    id: "gmail",
    title: "Gmail",
    category: "Communication",
    description: "Read property operations email and thread it into the shared inbox.",
    authMode: "oauth2",
    permissions: ["gmail.readonly"],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    webhook: false,
    readOnly: true,
    note: "Google OAuth with the narrow Gmail read-only scope.",
  },
  {
    id: "telegram",
    title: "Telegram",
    category: "Communication",
    description: "Connect a Telegram bot for tenant and contractor conversations.",
    authMode: "bot_token",
    permissions: ["Bot messages", "Webhook updates"],
    credentialFields: [
      { key: "botToken", label: "Bot token", secret: true },
      { key: "webhookSecret", label: "Webhook secret", secret: true },
    ],
    env: [],
    webhook: true,
    readOnly: false,
    note: "Webhook requests must include Telegram's configured secret-token header.",
  },
  {
    id: "twilio",
    title: "Calls & SMS",
    category: "Communication",
    description: "Place, receive, transcribe, and attach calls or SMS to the resident record.",
    authMode: "credentials",
    permissions: ["Calls", "Messages", "Recordings"],
    credentialFields: [
      { key: "accountSid", label: "Account SID" },
      { key: "authToken", label: "Auth token", secret: true },
    ],
    env: [],
    webhook: true,
    readOnly: false,
    note: "Designed for Twilio-compatible telephony; webhook signatures are required.",
  },
  {
    id: "granola",
    title: "Granola",
    category: "Knowledge",
    description: "Bring meeting notes and follow-ups into property and vendor timelines.",
    authMode: "api_key",
    permissions: ["Meeting notes", "Transcripts", "Participants"],
    credentialFields: [{ key: "apiKey", label: "Granola Business API key", secret: true }],
    env: [],
    webhook: false,
    readOnly: true,
    note: "Uses Granola's public API; its MCP OAuth route can be added for agent-to-agent access.",
  },
];

export function getProvider(id: string) {
  return integrationCatalog.find((provider) => provider.id === id);
}

export function configuredEnvironment(provider: IntegrationProvider, bindings: Record<string, unknown>) {
  return provider.env.length === 0 || provider.env.every((key) => Boolean(bindings[key]));
}
