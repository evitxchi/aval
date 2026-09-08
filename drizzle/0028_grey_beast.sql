CREATE TABLE `communication_poll_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_id` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_poll_source_uq` ON `communication_poll_sources` (`organization_id`,`provider`,`resource_id`);--> statement-breakpoint
CREATE INDEX `communication_poll_due_idx` ON `communication_poll_sources` (`enabled`,`last_attempt_at`);