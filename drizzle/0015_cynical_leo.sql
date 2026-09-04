CREATE TABLE `gl_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`account_type` text NOT NULL,
	`is_trust_account` integer DEFAULT false NOT NULL,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gl_accounts_org_code_uq` ON `gl_accounts` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `gl_accounts_org_type_idx` ON `gl_accounts` (`organization_id`,`account_type`);--> statement-breakpoint
CREATE TABLE `gl_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`posted_at` integer NOT NULL,
	`memo` text,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `gl_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gl_transactions_org_source_external_uq` ON `gl_transactions` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `gl_transactions_org_posted_idx` ON `gl_transactions` (`organization_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `gl_transactions_org_property_idx` ON `gl_transactions` (`organization_id`,`property_id`);--> statement-breakpoint
CREATE TABLE `lease_residents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`resident_id` text NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resident_id`) REFERENCES `residents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lease_residents_lease_resident_uq` ON `lease_residents` (`lease_id`,`resident_id`);--> statement-breakpoint
CREATE INDEX `lease_residents_org_idx` ON `lease_residents` (`organization_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`property_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`is_month_to_month` integer DEFAULT false NOT NULL,
	`move_in_date` integer,
	`move_out_date` integer,
	`rent_cents` integer NOT NULL,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`rent_due_day` integer DEFAULT 1 NOT NULL,
	`renewal_of_lease_id` text,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leases_org_source_external_uq` ON `leases` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `leases_org_status_idx` ON `leases` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `leases_org_end_idx` ON `leases` (`organization_id`,`end_date`);--> statement-breakpoint
CREATE INDEX `leases_unit_idx` ON `leases` (`unit_id`);--> statement-breakpoint
CREATE TABLE `leasing_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`property_id` text,
	`unit_id` text,
	`resident_id` text,
	`channel` text,
	`unit_type_label` text,
	`stage` text DEFAULT 'inquiry' NOT NULL,
	`inquired_at` integer NOT NULL,
	`contacted_at` integer,
	`toured_at` integer,
	`applied_at` integer,
	`approved_at` integer,
	`signed_at` integer,
	`lost_at` integer,
	`lost_reason` text,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resident_id`) REFERENCES `residents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leasing_leads_org_source_external_uq` ON `leasing_leads` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `leasing_leads_org_stage_idx` ON `leasing_leads` (`organization_id`,`stage`);--> statement-breakpoint
CREATE INDEX `leasing_leads_org_inquired_idx` ON `leasing_leads` (`organization_id`,`inquired_at`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`property_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`posted_at` integer NOT NULL,
	`due_at` integer,
	`memo` text,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_org_source_external_uq` ON `ledger_entries` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_org_lease_idx` ON `ledger_entries` (`organization_id`,`lease_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_org_posted_idx` ON `ledger_entries` (`organization_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_org_due_idx` ON `ledger_entries` (`organization_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `operations_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`value_a` text NOT NULL,
	`source_a` text NOT NULL,
	`value_b` text NOT NULL,
	`source_b` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`detected_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_conflicts_entity_field_uq` ON `operations_conflicts` (`organization_id`,`entity_type`,`entity_id`,`field`);--> statement-breakpoint
CREATE INDEX `operations_conflicts_org_status_idx` ON `operations_conflicts` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`address_line1` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text DEFAULT 'US' NOT NULL,
	`property_type` text DEFAULT 'multifamily' NOT NULL,
	`reported_unit_count` integer,
	`year_built` integer,
	`square_feet` integer,
	`acquisition_cost_cents` integer,
	`current_value_cents` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_org_source_external_uq` ON `properties` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `properties_org_status_idx` ON `properties` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `residents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`phone` text,
	`status` text DEFAULT 'current' NOT NULL,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `residents_org_source_external_uq` ON `residents` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `residents_org_status_idx` ON `residents` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`property_id` text NOT NULL,
	`unit_number` text NOT NULL,
	`bedrooms` integer,
	`bathrooms` real,
	`square_feet` integer,
	`market_rent_cents` integer,
	`status` text DEFAULT 'vacant_ready' NOT NULL,
	`vacant_since` integer,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_org_source_external_uq` ON `units` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `units_org_property_idx` ON `units` (`organization_id`,`property_id`);--> statement-breakpoint
CREATE INDEX `units_org_status_idx` ON `units` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`trade` text,
	`email` text,
	`phone` text,
	`insurance_expires_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_org_source_external_uq` ON `vendors` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `vendors_org_active_idx` ON `vendors` (`organization_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`property_id` text NOT NULL,
	`unit_id` text,
	`lease_id` text,
	`category` text DEFAULT 'general' NOT NULL,
	`priority` text DEFAULT 'routine' NOT NULL,
	`status` text DEFAULT 'reported' NOT NULL,
	`summary` text NOT NULL,
	`reported_at` integer NOT NULL,
	`assigned_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`vendor_id` text,
	`estimate_cents` integer,
	`actual_cost_cents` integer,
	`callback_of_work_order_id` text,
	`source_provider` text DEFAULT 'manual' NOT NULL,
	`source_connection_id` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_org_source_external_uq` ON `work_orders` (`organization_id`,`source_provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `work_orders_org_status_idx` ON `work_orders` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `work_orders_org_reported_idx` ON `work_orders` (`organization_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `work_orders_org_vendor_idx` ON `work_orders` (`organization_id`,`vendor_id`);--> statement-breakpoint
CREATE INDEX `work_orders_org_property_idx` ON `work_orders` (`organization_id`,`property_id`);