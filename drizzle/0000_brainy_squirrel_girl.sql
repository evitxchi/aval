CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`contact_display_name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`register` text DEFAULT 'professional' NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_org_channel_external_uq` ON `conversations` (`organization_id`,`channel`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `conversations_org_status_idx` ON `conversations` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `funnel_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source` text NOT NULL,
	`stage` text NOT NULL,
	`count` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `funnel_snapshots_org_captured_idx` ON `funnel_snapshots` (`organization_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`auth_mode` text NOT NULL,
	`external_account_id` text,
	`external_account_name` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`access_token_ciphertext` text,
	`refresh_token_ciphertext` text,
	`expires_at` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`last_sync_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_org_provider_uq` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE INDEX `integration_connections_org_status_idx` ON `integration_connections` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`connection_id` text,
	`provider` text NOT NULL,
	`external_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_events_provider_external_uq` ON `integration_events` (`provider`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `integration_events_provider_status_idx` ON `integration_events` (`provider`,`status`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`external_message_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_external_uq` ON `messages` (`conversation_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`user_id` text NOT NULL,
	`code_verifier` text,
	`return_to` text DEFAULT '/?view=connections' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expiry_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source` text NOT NULL,
	`metric_key` text NOT NULL,
	`numeric_value` integer,
	`text_value` text,
	`period_start` integer,
	`period_end` integer,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_org_captured_idx` ON `portfolio_snapshots` (`organization_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_runs_connection_started_idx` ON `sync_runs` (`connection_id`,`started_at`);