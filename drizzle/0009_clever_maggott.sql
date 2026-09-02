CREATE TABLE `utility_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`usage_amount` real NOT NULL,
	`cost_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`source` text NOT NULL,
	`extraction_confidence` text,
	`extraction_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meter_id`) REFERENCES `utility_meters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `utility_bills_org_period_idx` ON `utility_bills` (`organization_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `utility_bills_meter_period_idx` ON `utility_bills` (`meter_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `utility_meters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`utility_type` text NOT NULL,
	`property_label` text NOT NULL,
	`unit_label` text,
	`meter_number` text,
	`provider` text,
	`unit_of_measure` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `utility_meters_org_type_idx` ON `utility_meters` (`organization_id`,`utility_type`);