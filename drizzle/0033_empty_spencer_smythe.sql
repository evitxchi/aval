CREATE TABLE `channel_thread_state` (
	`channel_identity_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`overflow` text,
	`overflow_expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_identity_id`) REFERENCES `channel_identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
