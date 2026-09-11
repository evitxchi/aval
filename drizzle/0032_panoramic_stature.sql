CREATE TABLE `action_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_action_id` text NOT NULL,
	`tool` text NOT NULL,
	`before` text NOT NULL,
	`reversible` integer DEFAULT false NOT NULL,
	`reverted_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_checkpoints_action_uq` ON `action_checkpoints` (`organization_id`,`agent_action_id`);--> statement-breakpoint
CREATE INDEX `action_checkpoints_org_expiry_idx` ON `action_checkpoints` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `channel_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`contact_id` text,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`role` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `residents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_identities_channel_external_uq` ON `channel_identities` (`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `channel_identities_org_idx` ON `channel_identities` (`organization_id`,`channel`);--> statement-breakpoint
CREATE TABLE `channel_link_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_by_external_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_link_codes_org_idx` ON `channel_link_codes` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `channel_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_identity_id` text NOT NULL,
	`tool` text NOT NULL,
	`args_json` text NOT NULL,
	`recipients_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_identity_id`) REFERENCES `channel_identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_pending_actions_identity_idx` ON `channel_pending_actions` (`channel_identity_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `channel_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_identity_id` text NOT NULL,
	`trigger` text NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`schedule` text NOT NULL,
	`gate` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_identity_id`) REFERENCES `channel_identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_subscriptions_due_idx` ON `channel_subscriptions` (`active`,`last_run_at`);--> statement-breakpoint
CREATE INDEX `channel_subscriptions_org_idx` ON `channel_subscriptions` (`organization_id`);