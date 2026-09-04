CREATE TABLE `agent_approval_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`approval_id`) REFERENCES `agent_approvals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approval_decisions_approval_user_uq` ON `agent_approval_decisions` (`approval_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agent_approval_decisions_org_created_idx` ON `agent_approval_decisions` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_execution_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`single_approval_max_cents` integer DEFAULT 50000 NOT NULL,
	`hard_ceiling_cents` integer DEFAULT 2500000 NOT NULL,
	`daily_limit_cents` integer DEFAULT 5000000 NOT NULL,
	`allowed_currencies_json` text DEFAULT '["USD"]' NOT NULL,
	`allowed_account_fingerprints_json` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by_user_id` text,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_financial_events` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_digest` text NOT NULL,
	`external_transaction_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `agent_financial_operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_financial_events_operation_sequence_uq` ON `agent_financial_events` (`operation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `agent_financial_events_org_created_idx` ON `agent_financial_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_financial_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`task_id` text NOT NULL,
	`approval_id` text,
	`step_index` integer NOT NULL,
	`tool_name` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`account_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`reconciliation_status` text DEFAULT 'pending' NOT NULL,
	`external_transaction_id` text,
	`result_digest` text,
	`discrepancy_code` text,
	`reconcile_attempts` integer DEFAULT 0 NOT NULL,
	`next_reconcile_at` integer NOT NULL,
	`last_reconciled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `agent_approvals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_financial_operations_idempotency_uq` ON `agent_financial_operations` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_financial_operations_external_uq` ON `agent_financial_operations` (`tool_name`,`external_transaction_id`);--> statement-breakpoint
CREATE INDEX `agent_financial_operations_reconcile_idx` ON `agent_financial_operations` (`reconciliation_status`,`next_reconcile_at`);--> statement-breakpoint
CREATE INDEX `agent_financial_operations_org_created_idx` ON `agent_financial_operations` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_worker_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`tasks_scanned` integer DEFAULT 0 NOT NULL,
	`tasks_advanced` integer DEFAULT 0 NOT NULL,
	`tasks_completed` integer DEFAULT 0 NOT NULL,
	`tasks_failed` integer DEFAULT 0 NOT NULL,
	`tasks_parked` integer DEFAULT 0 NOT NULL,
	`error_digest` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `agent_worker_runs_started_idx` ON `agent_worker_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `required_approvals` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `approvals_received` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `policy_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `execution_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `last_heartbeat_at` integer;--> statement-breakpoint
CREATE INDEX `agent_tasks_status_attempt_idx` ON `agent_tasks` (`status`,`next_attempt_at`);