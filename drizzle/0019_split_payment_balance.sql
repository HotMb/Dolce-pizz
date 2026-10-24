ALTER TABLE `orders` ADD `paid_total` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `orders_tenant_payment_balance` ON `orders` (`organization_id`,`location_id`,`status`,`payment_status`,`paid_total`);--> statement-breakpoint
