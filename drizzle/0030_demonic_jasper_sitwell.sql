CREATE TABLE `agent_model_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`task_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`context_json` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `agent_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_model_context_task_idx` ON `agent_model_contexts` (`organization_id`,`task_id`,`step_index`);
--> statement-breakpoint
CREATE TRIGGER agent_memory_no_update BEFORE UPDATE ON agent_memory BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;

--> statement-breakpoint
CREATE TRIGGER agent_memory_no_delete BEFORE DELETE ON agent_memory BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;

--> statement-breakpoint
CREATE TRIGGER agent_checks_no_update BEFORE UPDATE ON agent_checks BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;

--> statement-breakpoint
CREATE TRIGGER agent_checks_no_delete BEFORE DELETE ON agent_checks BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;

--> statement-breakpoint
CREATE TRIGGER agent_model_contexts_no_update BEFORE UPDATE ON agent_model_contexts BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;

--> statement-breakpoint
CREATE TRIGGER agent_model_contexts_no_delete BEFORE DELETE ON agent_model_contexts BEGIN SELECT RAISE(ABORT, 'append-only agent journal'); END;
