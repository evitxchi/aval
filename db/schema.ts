import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Real customer accounts for deployments outside ChatGPT Sites, where there
// is no platform-injected identity header — email/password, hashed with
// PBKDF2 (lib/auth/password.ts), never stored or logged in plain text.
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("users_email_uq").on(table.email)],
);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("pending"),
    authMode: text("auth_mode").notNull(),
    externalAccountId: text("external_account_id"),
    externalAccountName: text("external_account_name"),
    scopesJson: text("scopes_json").notNull().default("[]"),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    metadataJson: text("metadata_json").notNull().default("{}"),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_connections_org_provider_uq").on(table.organizationId, table.provider),
    index("integration_connections_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    provider: text("provider").notNull(),
    userId: text("user_id").notNull(),
    codeVerifier: text("code_verifier"),
    returnTo: text("return_to").notNull().default("/?view=connections"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oauth_states_expiry_idx").on(table.expiresAt)],
);

export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    connectionId: text("connection_id").references(() => integrationConnections.id),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("received"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("integration_events_provider_external_uq").on(table.provider, table.externalEventId),
    index("integration_events_provider_status_idx").on(table.provider, table.status),
  ],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    connectionId: text("connection_id").notNull().references(() => integrationConnections.id),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    cursorJson: text("cursor_json").notNull().default("{}"),
    countsJson: text("counts_json").notNull().default("{}"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("sync_runs_connection_started_idx").on(table.connectionId, table.startedAt)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    channel: text("channel").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    contactDisplayName: text("contact_display_name").notNull(),
    status: text("status").notNull().default("open"),
    locale: text("locale").notNull().default("en"),
    register: text("register").notNull().default("professional"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("conversations_org_channel_external_uq").on(table.organizationId, table.channel, table.externalThreadId),
    index("conversations_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
    externalMessageId: text("external_message_id").notNull(),
    direction: text("direction").notNull(),
    body: text("body").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("messages_conversation_external_uq").on(table.conversationId, table.externalMessageId),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    source: text("source").notNull(),
    metricKey: text("metric_key").notNull(),
    numericValue: integer("numeric_value"),
    textValue: text("text_value"),
    periodStart: integer("period_start", { mode: "timestamp_ms" }),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("portfolio_snapshots_org_captured_idx").on(table.organizationId, table.capturedAt)],
);

export const funnelSnapshots = sqliteTable(
  "funnel_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    source: text("source").notNull(),
    stage: text("stage").notNull(),
    count: integer("count").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("funnel_snapshots_org_captured_idx").on(table.organizationId, table.capturedAt)],
);

// Ask Aval's daily spend guard: one row per model call, so a per-org daily
// cap can be enforced by counting rows for today rather than trusting an
// in-memory counter that a Worker isolate wouldn't reliably persist anyway.
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_usage_org_day_idx").on(table.organizationId, table.day)],
);

// One row per org, tracking its current Stripe subscription. planId is a
// key into lib/billing/plans.ts's PLANS array, not a foreign key: plans are
// defined in code, not the database, since they change by editing that
// file rather than running a migration.
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    planId: text("plan_id").notNull(),
    status: text("status").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodStart: integer("current_period_start", { mode: "timestamp_ms" }),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("subscriptions_org_uq").on(table.organizationId)],
);

// One row per completed one-time "buy more tokens" purchase. Token balance
// is the sum of tokensGranted across all rows for an org, not a running
// counter column, so a webhook retried by Stripe (deduplicated on
// stripeSessionId) can never double- or under-credit a purchase.
export const tokenTopUps = sqliteTable(
  "token_top_ups",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    stripeSessionId: text("stripe_session_id").notNull(),
    packId: text("pack_id").notNull(),
    tokensGranted: integer("tokens_granted").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("token_top_ups_session_uq").on(table.stripeSessionId)],
);

// Every finished (or failed) Ask Aval Tasks draft, so a refresh doesn't lose
// it — the client's draft-job state is otherwise purely in-memory.
export const draftDocuments = sqliteTable(
  "draft_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    format: text("format").notNull(),
    status: text("status").notNull(),
    headline: text("headline"),
    documentMarkdown: text("document_markdown"),
    metricsJson: text("metrics_json").notNull().default("[]"),
    confidence: text("confidence"),
    errorMessage: text("error_message"),
    sentTo: text("sent_to"),
    moduleLabel: text("module_label"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("draft_documents_org_created_idx").on(table.organizationId, table.createdAt)],
);

// A structured, redacted workflow preference — never raw tenant/financial
// content — that Ask Aval reads back as context. See
// lib/ask-aval/preferences.ts for what is and isn't allowed to land here.
export const learnedPreferences = sqliteTable(
  "learned_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    topic: text("topic").notNull(),
    statement: text("statement").notNull(),
    source: text("source").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("learned_preferences_org_topic_uq").on(table.organizationId, table.topic),
    index("learned_preferences_org_idx").on(table.organizationId),
  ],
);

// One run per triggered automation (e.g. a maintenance issue routed to a
// vendor). insightId ties back to the real sample insight that triggered
// it — no synthetic trigger data.
export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    insightId: text("insight_id").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("automation_runs_org_created_idx").on(table.organizationId, table.createdAt)],
);

// Each timeline entry within a run, in order.
export const automationSteps = sqliteTable(
  "automation_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => automationRuns.id),
    kind: text("kind").notNull(),
    actorLabel: text("actor_label").notNull(),
    summary: text("summary").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("automation_steps_run_idx").on(table.runId)],
);
