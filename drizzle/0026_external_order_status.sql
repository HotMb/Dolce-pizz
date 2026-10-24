-- Preserve the partner lifecycle separately from the local POS/KDS lifecycle.
ALTER TABLE `orders` ADD `external_status` text;
--> statement-breakpoint
CREATE INDEX `orders_external_status` ON `orders` (`organization_id`,`location_id`,`external_provider`,`external_status`,`updated_at`);
