DROP INDEX `agent_financial_operations_reconcile_idx`;--> statement-breakpoint
ALTER TABLE `agent_financial_operations` ADD `reconcile_lease_owner` text;--> statement-breakpoint
ALTER TABLE `agent_financial_operations` ADD `reconcile_lease_expires_at` integer;--> statement-breakpoint
CREATE INDEX `agent_financial_operations_reconcile_idx` ON `agent_financial_operations` (`reconciliation_status`,`next_reconcile_at`,`reconcile_lease_expires_at`);