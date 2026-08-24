CREATE TABLE `insight_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`insight_id` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `insight_decisions_org_insight_idx` ON `insight_decisions` (`organization_id`,`insight_id`);