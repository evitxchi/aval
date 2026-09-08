CREATE TABLE `integration_sync_state` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`external_account_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`next_run_at` integer NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `integration_sync_due_idx` ON `integration_sync_state` (`enabled`,`next_run_at`);