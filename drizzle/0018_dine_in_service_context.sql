ALTER TABLE `orders` ADD `service_mode` text NOT NULL DEFAULT 'pickup';--> statement-breakpoint
ALTER TABLE `orders` ADD `table_label` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `orders_tenant_service_mode` ON `orders` (`organization_id`,`location_id`,`service_mode`,`status`);--> statement-breakpoint
