CREATE TABLE `user_onboarding` (
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`preferences` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_onboarding_user_org_uq` ON `user_onboarding` (`user_id`,`organization_id`);