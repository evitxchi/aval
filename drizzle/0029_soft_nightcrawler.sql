CREATE TABLE `agent_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`task_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`exit_code` integer NOT NULL,
	`output_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_checks_task_idx` ON `agent_checks` (`organization_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`task_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`request_key` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_memory_request_uq` ON `agent_memory` (`organization_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `agent_memory_task_step_idx` ON `agent_memory` (`task_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `agent_plan_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`root_task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`node_key` text NOT NULL,
	`task_id` text NOT NULL,
	`dependencies_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_plan_node_uq` ON `agent_plan_nodes` (`root_task_id`,`revision`,`node_key`);--> statement-breakpoint
CREATE INDEX `agent_plan_root_idx` ON `agent_plan_nodes` (`root_task_id`,`revision`);--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `check_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `deadline_at` integer;