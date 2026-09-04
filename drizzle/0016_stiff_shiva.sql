CREATE TABLE `agent_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`tool_name` text NOT NULL,
	`risk_level` text NOT NULL,
	`tier` text NOT NULL,
	`amount_cents` integer,
	`currency` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by_user_id` text,
	`decision_note` text,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_approvals_org_status_idx` ON `agent_approvals` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_task_step_uq` ON `agent_approvals` (`task_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `agent_task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`step_index` integer NOT NULL,
	`kind` text NOT NULL,
	`tool_name` text,
	`policy_effect` text,
	`deny_code` text,
	`risk_level` text,
	`args_digest` text,
	`result_digest` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`idempotency_key` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_steps_task_sequence_uq` ON `agent_task_steps` (`task_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_steps_idempotency_uq` ON `agent_task_steps` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_task_steps_task_idx` ON `agent_task_steps` (`task_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`goal` text NOT NULL,
	`status` text NOT NULL,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`step_count` integer DEFAULT 0 NOT NULL,
	`max_steps` integer NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`max_tokens` integer NOT NULL,
	`parent_task_id` text,
	`delegation_depth` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`result_json` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_tasks_org_created_idx` ON `agent_tasks` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_tasks_status_lease_idx` ON `agent_tasks` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `agent_tasks_parent_idx` ON `agent_tasks` (`parent_task_id`);