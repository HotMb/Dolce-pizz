CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `devices_location_status` ON `devices` (`organization_id`,`location_id`,`status`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'unconfigured' NOT NULL,
	`address_line1` text,
	`postal_code` text,
	`locality` text,
	`phone` text,
	`country_code` text DEFAULT 'FR' NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_org_code` ON `locations` (`organization_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `locations_org_id` ON `locations` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `locations_org_status` ON `locations` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`principal_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_scope` ON `organization_memberships` (`organization_id`,`principal_id`,`role`,`location_id`);--> statement-breakpoint
CREATE INDEX `organization_memberships_principal` ON `organization_memberships` (`principal_id`,`status`);--> statement-breakpoint
CREATE INDEX `organization_memberships_location` ON `organization_memberships` (`organization_id`,`location_id`,`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`country_code` text DEFAULT 'FR' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_status` ON `organizations` (`status`);--> statement-breakpoint
ALTER TABLE `orders` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `location_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `channel` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment` text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_status` text DEFAULT 'due_at_pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_method` text;--> statement-breakpoint
CREATE INDEX `orders_tenant_location_created` ON `orders` (`organization_id`,`location_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_tenant_channel_status` ON `orders` (`organization_id`,`channel`,`status`);
--> statement-breakpoint
-- Bootstrap the existing Dolce Pizza tenant. Tourcoing intentionally has no invented contact or address data.
INSERT OR IGNORE INTO `organizations` (`id`,`name`,`slug`,`country_code`,`status`,`created_at`,`updated_at`)
VALUES ('dolce-pizza','Dolce Pizz’','dolce-pizza','FR','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
INSERT OR IGNORE INTO `locations` (`id`,`organization_id`,`code`,`name`,`status`,`address_line1`,`postal_code`,`locality`,`phone`,`country_code`,`timezone`,`created_at`,`updated_at`)
VALUES ('ronchin','dolce-pizza','ronchin','Dolce Pizz’ — Ronchin','active','191 avenue Jean-Jaurès','59790','Ronchin','+33 3 20 40 09 01','FR','Europe/Paris',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
INSERT OR IGNORE INTO `locations` (`id`,`organization_id`,`code`,`name`,`status`,`address_line1`,`postal_code`,`locality`,`phone`,`country_code`,`timezone`,`created_at`,`updated_at`)
VALUES ('tourcoing','dolce-pizza','tourcoing','Dolce Pizz’ — Tourcoing','unconfigured',NULL,NULL,NULL,NULL,'FR','Europe/Paris',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
-- Existing prototype orders all came from the Ronchin web pickup flow.
UPDATE `orders`
SET `organization_id` = COALESCE(`organization_id`, 'dolce-pizza'),
    `location_id` = COALESCE(`location_id`, 'ronchin'),
    `payment_status` = CASE
      WHEN `status` = 'completed' THEN 'paid'
      WHEN `status` IN ('rejected','cancelled') THEN 'not_required'
      ELSE 'due_at_pickup'
    END
WHERE `organization_id` IS NULL OR `location_id` IS NULL OR `payment_status` = 'due_at_pickup';
--> statement-breakpoint
-- SQLite has no row-level security. At minimum, every new/updated order must belong to a real location in its organization.
CREATE TRIGGER `orders_location_scope_insert`
BEFORE INSERT ON `orders`
WHEN NEW.`organization_id` IS NULL OR NEW.`location_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `locations`
    WHERE `organization_id` = NEW.`organization_id` AND `id` = NEW.`location_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid order location scope');
END;
--> statement-breakpoint
CREATE TRIGGER `orders_location_scope_update`
BEFORE UPDATE OF `organization_id`, `location_id` ON `orders`
WHEN NEW.`organization_id` IS NULL OR NEW.`location_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `locations`
    WHERE `organization_id` = NEW.`organization_id` AND `id` = NEW.`location_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid order location scope');
END;
