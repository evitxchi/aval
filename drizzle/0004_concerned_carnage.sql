CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`insight_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automation_runs_org_created_idx` ON `automation_runs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_label` text NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automation_steps_run_idx` ON `automation_steps` (`run_id`);--> statement-breakpoint
CREATE TABLE `draft_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`headline` text,
	`document_markdown` text,
	`metrics_json` text DEFAULT '[]' NOT NULL,
	`confidence` text,
	`error_message` text,
	`sent_to` text,
	`module_label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `draft_documents_org_created_idx` ON `draft_documents` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `learned_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`topic` text NOT NULL,
	`statement` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learned_preferences_org_topic_uq` ON `learned_preferences` (`organization_id`,`topic`);--> statement-breakpoint
CREATE INDEX `learned_preferences_org_idx` ON `learned_preferences` (`organization_id`);