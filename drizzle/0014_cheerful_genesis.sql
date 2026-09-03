CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`content_text` text NOT NULL,
	`char_count` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_org_idx` ON `documents` (`organization_id`);