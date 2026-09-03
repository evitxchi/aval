import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  // Which connected model-provider ProviderId (integration_connections.provider,
  // category "Model") powers agents/Ask Aval for this org. Null means Aval's
  // own bundled Anthropic key (env.ANTHROPIC_API_KEY) — see lib/ask-aval/model-router.ts.
  activeModelProvider: text("active_model_provider"),
  // Which persona (a built-in PersonaId or a custom_personas row's id) Ask
  // Aval opens with by default for this org — set from Settings → Aval
  // Setup. Null means the built-in "general" persona, matching this app's
  // behavior before this column existed.
  defaultPersonaId: text("default_persona_id"),
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
    // A reply Ask Aval drafted the moment the latest inbound message arrived
    // (lib/ask-aval/auto-reply.ts), pre-filled in the Inbox composer for a
    // human to edit or send. Never sent automatically — see draftReplyStatus.
    draftReply: text("draft_reply"),
    draftReplyStatus: text("draft_reply_status"),
    draftReplyAt: integer("draft_reply_at", { mode: "timestamp_ms" }),
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
    narrative: text("narrative"),
    documentType: text("document_type"),
    documentMarkdown: text("document_markdown"),
    metricsJson: text("metrics_json").notNull().default("[]"),
    chartJson: text("chart_json"),
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

// One row per rate-limited attempt (signup, login), never per-window —
// counted by querying rows within the window, the same idiom ai_usage
// already uses for the daily model-call cap, so the limiter needs no
// separate counter that a Worker isolate wouldn't reliably persist anyway.
// scopeKey encodes both the action and the identity being limited (e.g.
// "signup:ip:203.0.113.4" or "login:email:a@b.com") so IP-based and
// account-based limits can coexist without cross-contaminating.
export const rateLimitHits = sqliteTable(
  "rate_limit_hits",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("rate_limit_hits_scope_created_idx").on(table.scopeKey, table.createdAt)],
);

// One row per approve/deny/send decision on an actionable insight — the
// richest real usage signal in the app, previously only client-side state
// that vanished on refresh and was invisible to Ask Aval. insightId and
// decision are both from a small fixed set (never free text), so this
// stays as privacy-safe as learned_preferences by construction, not by
// filtering: there is no field here a tenant name or dollar amount could
// end up in. See lib/ask-aval/usage-patterns.ts for how this is read back.
export const insightDecisions = sqliteTable(
  "insight_decisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    insightId: text("insight_id").notNull(),
    decision: text("decision").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("insight_decisions_org_insight_idx").on(table.organizationId, table.insightId)],
);

// A physical (or, pre-connection, manually tracked) electricity/water/gas
// meter. There is no `properties`/`units` table yet — see docs/DECISIONS.md
// — so meters are scoped to the org with a free-text property/unit label,
// the same shape `insightDecisions` uses above for referencing a sample-data
// id that doesn't have a real table behind it yet. Once a real property
// table exists, propertyLabel/unitLabel should become propertyId/unitId.
export const utilityMeters = sqliteTable(
  "utility_meters",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    utilityType: text("utility_type").notNull(), // "electricity" | "water" | "gas"
    propertyLabel: text("property_label").notNull(),
    unitLabel: text("unit_label"),
    meterNumber: text("meter_number"),
    provider: text("provider"),
    unitOfMeasure: text("unit_of_measure").notNull(), // "kWh" | "gal" | "ccf" | "therm" | "m3"
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("utility_meters_org_type_idx").on(table.organizationId, table.utilityType)],
);

// One row per billing-period read for a meter. usageAmount is a `real`
// column since utility usage is fractional (1,234.56 kWh); costCents stays
// an integer, matching how money is stored everywhere else in this schema
// (see `tokenTopUps`, billing) — see lib/finance/money.ts for the
// dinero.js-backed arithmetic that operates on it.
export const utilityBills = sqliteTable(
  "utility_bills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    meterId: text("meter_id").notNull().references(() => utilityMeters.id),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    usageAmount: real("usage_amount").notNull(),
    costCents: integer("cost_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    source: text("source").notNull(), // "manual" | "ai_extracted"
    extractionConfidence: text("extraction_confidence"), // set only when source is "ai_extracted"
    extractionNote: text("extraction_note"), // model's own caveat about the extraction, shown to the user, never trusted silently
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("utility_bills_org_period_idx").on(table.organizationId, table.periodStart),
    index("utility_bills_meter_period_idx").on(table.meterId, table.periodStart),
  ],
);

// A workspace-defined Ask Aval persona, alongside the fixed built-in roster
// in lib/ask-aval/personas.ts (general/financial/brokerage/realEstate/
// marketResearch/maintenance). focusDescription becomes a system-prompt
// *addition*, never a replacement — see lib/ask-aval/custom-personas.ts for
// why an operator-authored focus can't be used to bypass the faithfulness
// gate or reach a tool outside toolNamesJson, regardless of its wording.
export const agentPersonas = sqliteTable(
  "agent_personas",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    label: text("label").notNull(),
    focusDescription: text("focus_description").notNull(),
    toolNamesJson: text("tool_names_json"), // JSON string array, or null meaning "every tool" (matches AgentPersona.toolNames)
    shape: text("shape").notNull(), // ShapeId, app/components/agent-avatar/shapes.tsx
    theme: text("theme").notNull(), // ThemeId, app/components/agent-avatar/themes.ts
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("agent_personas_org_idx").on(table.organizationId)],
);

// A tamper-evident record of what Ask Aval did to produce each answer: which
// tools ran, whether the faithfulness gate passed, and a digest of the answer.
// Each row commits to the previous row's hash (see lib/audit/chain.ts), so the
// trail can be re-verified and any edit, deletion or reordering surfaces.
//
// Deliberately stores DIGESTS, not payloads. Tool results carry resident names
// and balances; keeping them here would make this table a second, indefinitely
// retained copy of the most sensitive data in the app. `label` holds only a
// tool name or a gate outcome, and `count` only a magnitude — neither is
// identifying. Same trade as learned_preferences: keep the structure, drop the
// content.
export const answerAuditLog = sqliteTable(
  "answer_audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    // 1-based, contiguous per organization — a gap is itself evidence.
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(), // AuditEntryKind
    label: text("label").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    count: integer("count").notNull(),
    previousHash: text("previous_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // Enforces contiguity at the database level: two concurrent runs cannot
    // both claim the same position, so a race fails loudly instead of forking
    // the chain into two branches that each look valid alone.
    uniqueIndex("answer_audit_log_org_sequence_uq").on(table.organizationId, table.sequence),
    index("answer_audit_log_org_idx").on(table.organizationId),
  ],
);

// Documents a workspace pastes in for Aval to read: leases, owner and lender
// statements, vendor estimates. This is the ingestion layer two deferred agent
// ideas needed (docs/DECISIONS.md) — document financial extraction, and a
// lease-review persona that can answer about a specific contract.
//
// Unlike learned_preferences and answer_audit_log, this table DOES hold raw
// third-party text, because that is the whole point: you cannot review a lease
// without the lease. The controls are therefore explicit rather than
// structural — org scoping like every other row, a hard size cap, and
// user-initiated deletion — and `lib/ask-aval/handler.ts`'s standing rule that
// tool output is data and never instructions matters more here than anywhere
// else, since a lease is authored by someone outside the workspace.
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // DocumentKind, lib/documents/types.ts
    contentText: text("content_text").notNull(),
    // Denormalized so the list view can show size without reading every body.
    charCount: integer("char_count").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("documents_org_idx").on(table.organizationId)],
);
