CREATE TABLE `rate_limit_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_hits_scope_created_idx` ON `rate_limit_hits` (`scope_key`,`created_at`);