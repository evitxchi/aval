CREATE TABLE `answer_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`payload_digest` text NOT NULL,
	`count` integer NOT NULL,
	`previous_hash` text NOT NULL,
	`entry_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_audit_log_org_sequence_uq` ON `answer_audit_log` (`organization_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `answer_audit_log_org_idx` ON `answer_audit_log` (`organization_id`);