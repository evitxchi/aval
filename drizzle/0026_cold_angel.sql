CREATE TABLE `communication_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`request_key` text NOT NULL,
	`payload_digest` text NOT NULL,
	`kind` text NOT NULL,
	`destination` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_deliveries_org_request_uq` ON `communication_deliveries` (`organization_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `communication_deliveries_org_created_idx` ON `communication_deliveries` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `communication_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
