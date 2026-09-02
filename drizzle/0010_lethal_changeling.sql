CREATE TABLE `agent_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`label` text NOT NULL,
	`focus_description` text NOT NULL,
	`tool_names_json` text,
	`shape` text NOT NULL,
	`theme` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_personas_org_idx` ON `agent_personas` (`organization_id`);