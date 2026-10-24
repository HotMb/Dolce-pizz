-- Customer identity (users) remains global for OTP authentication. Every commercial
-- relationship, consent, loyalty entry and campaign is owned by an organization.
CREATE TABLE `customer_profiles` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`marketing` integer DEFAULT 0 NOT NULL CHECK (`marketing` IN (0,1)),
	`marketing_at` text DEFAULT '' NOT NULL,
	`marketing_source` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`organization_id`,`user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_profiles_marketing` ON `customer_profiles` (`organization_id`,`marketing`,`user_id`);
--> statement-breakpoint
INSERT INTO `customer_profiles` (`organization_id`,`user_id`,`name`,`marketing`,`marketing_at`,`marketing_source`,`created_at`,`updated_at`)
SELECT 'dolce-pizza',`id`,`name`,`marketing`,`marketing_at`,`marketing_source`,`created_at`,
       CASE WHEN `marketing_at`<>'' THEN `marketing_at` ELSE `created_at` END
FROM `users`
WHERE EXISTS(SELECT 1 FROM `organizations` WHERE `id`='dolce-pizza');
--> statement-breakpoint
CREATE TABLE `marketing_consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`marketing` integer NOT NULL CHECK (`marketing` IN (0,1)),
	`source` text NOT NULL,
	`actor` text NOT NULL,
	`occurred_at` text NOT NULL,
	CHECK (`source` IN ('migration','inscription','compte','commande','stop')),
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `customer_profiles`(`organization_id`,`user_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `marketing_consent_events_profile` ON `marketing_consent_events` (`organization_id`,`user_id`,`occurred_at`);
--> statement-breakpoint
INSERT INTO `marketing_consent_events` (`id`,`organization_id`,`user_id`,`marketing`,`source`,`actor`,`occurred_at`)
SELECT 'migration:dolce-pizza:'||`id`,'dolce-pizza',`id`,`marketing`,
       CASE WHEN `marketing_source` IN ('inscription','compte','commande','stop') THEN `marketing_source` ELSE 'migration' END,
       'migration',CASE WHEN `marketing_at`<>'' THEN `marketing_at` ELSE `created_at` END
FROM `users`
WHERE `marketing`=1 OR `marketing_at`<>'' OR `marketing_source`<>'';
--> statement-breakpoint
CREATE TRIGGER `marketing_consent_events_immutable_update`
BEFORE UPDATE ON `marketing_consent_events`
BEGIN SELECT RAISE(ABORT, 'marketing consent history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `marketing_consent_events_immutable_delete`
BEFORE DELETE ON `marketing_consent_events`
BEGIN SELECT RAISE(ABORT, 'marketing consent history is immutable'); END;
--> statement-breakpoint

-- Separate the authenticated/employee actor from the actual customer. Existing web
-- orders belong to their authenticated account; staff-created tickets stay anonymous.
ALTER TABLE `orders` ADD `customer_user_id` text;
--> statement-breakpoint
UPDATE `orders` SET `customer_user_id`=`user_id` WHERE `channel`='web';
--> statement-breakpoint
CREATE INDEX `orders_customer_created` ON `orders` (`organization_id`,`customer_user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_id` ON `orders` (`organization_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `orders_customer_scope_insert`
BEFORE INSERT ON `orders`
WHEN (NEW.`channel`='web' AND (NEW.`customer_user_id` IS NULL OR NEW.`customer_user_id`<>NEW.`user_id`))
  OR (NEW.`customer_user_id` IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM `customer_profiles`
    WHERE `organization_id`=NEW.`organization_id` AND `user_id`=NEW.`customer_user_id`
  ))
BEGIN SELECT RAISE(ABORT, 'invalid order customer scope'); END;
--> statement-breakpoint
CREATE TRIGGER `orders_customer_scope_update`
BEFORE UPDATE OF `organization_id`,`channel`,`user_id`,`customer_user_id` ON `orders`
WHEN (NEW.`channel`='web' AND (NEW.`customer_user_id` IS NULL OR NEW.`customer_user_id`<>NEW.`user_id`))
  OR (NEW.`customer_user_id` IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM `customer_profiles`
    WHERE `organization_id`=NEW.`organization_id` AND `user_id`=NEW.`customer_user_id`
  ))
BEGIN SELECT RAISE(ABORT, 'invalid order customer scope'); END;
--> statement-breakpoint

-- Abort rather than silently dropping historical accounting or campaign data if a
-- legacy database contains an orphan. Operators must repair it before retrying.
CREATE TABLE `_tenant_customer_migration_guard` (`invalid_rows` integer CHECK (`invalid_rows`=0));
--> statement-breakpoint
INSERT INTO `_tenant_customer_migration_guard`
SELECT COUNT(*) FROM `ledger` l LEFT JOIN `orders` o ON o.`id`=l.`order_id`
WHERE o.`id` IS NULL OR o.`organization_id` IS NULL OR o.`customer_user_id` IS NULL OR o.`customer_user_id`<>l.`user_id`;
--> statement-breakpoint
INSERT INTO `_tenant_customer_migration_guard`
SELECT COUNT(*) FROM `campaigns` c LEFT JOIN `users` u ON u.`id`=c.`created_by` WHERE u.`id` IS NULL;
--> statement-breakpoint
INSERT INTO `_tenant_customer_migration_guard`
SELECT COUNT(*) FROM `campaign_recipients` r
LEFT JOIN `campaigns` c ON c.`id`=r.`campaign_id`
LEFT JOIN `users` u ON u.`id`=r.`user_id`
WHERE c.`id` IS NULL OR u.`id` IS NULL;
--> statement-breakpoint
INSERT INTO `_tenant_customer_migration_guard`
SELECT COUNT(*) FROM (
  SELECT 1 FROM `campaigns` WHERE `status`='sending' GROUP BY `status` HAVING COUNT(*)>1
);
--> statement-breakpoint
DROP TABLE `_tenant_customer_migration_guard`;
--> statement-breakpoint

ALTER TABLE `ledger` RENAME TO `_ledger_legacy`;
--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`delta` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `customer_profiles`(`organization_id`,`user_id`),
	FOREIGN KEY (`organization_id`,`order_id`) REFERENCES `orders`(`organization_id`,`id`)
);
--> statement-breakpoint
INSERT INTO `ledger` (`id`,`organization_id`,`user_id`,`order_id`,`delta`,`kind`,`created_at`)
SELECT l.`id`,o.`organization_id`,l.`user_id`,l.`order_id`,l.`delta`,l.`kind`,l.`created_at`
FROM `_ledger_legacy` l JOIN `orders` o ON o.`id`=l.`order_id`;
--> statement-breakpoint
DROP TABLE `_ledger_legacy`;
--> statement-breakpoint
CREATE INDEX `ledger_organization_user` ON `ledger` (`organization_id`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_organization_order_kind` ON `ledger` (`organization_id`,`order_id`,`kind`);
--> statement-breakpoint
CREATE TRIGGER `ledger_scope_insert`
BEFORE INSERT ON `ledger`
WHEN NOT EXISTS(
  SELECT 1 FROM `orders` o
  WHERE o.`id`=NEW.`order_id` AND o.`organization_id`=NEW.`organization_id`
    AND o.`customer_user_id`=NEW.`user_id` AND o.`channel`='web'
)
BEGIN SELECT RAISE(ABORT, 'invalid loyalty ledger scope'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_immutable_update`
BEFORE UPDATE ON `ledger`
BEGIN SELECT RAISE(ABORT, 'loyalty ledger is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_immutable_delete`
BEFORE DELETE ON `ledger`
BEGIN SELECT RAISE(ABORT, 'loyalty ledger is immutable'); END;
--> statement-breakpoint
-- A client order's commercial owner is immutable. This also protects entries before
-- the first loyalty row exists; the composite ledger FK protects the accounting side.
CREATE TRIGGER `orders_commercial_scope_immutable`
BEFORE UPDATE OF `organization_id`,`location_id`,`customer_user_id` ON `orders`
WHEN OLD.`customer_user_id` IS NOT NULL
 AND (NEW.`organization_id` IS NOT OLD.`organization_id`
   OR NEW.`location_id` IS NOT OLD.`location_id`
   OR NEW.`customer_user_id` IS NOT OLD.`customer_user_id`)
BEGIN SELECT RAISE(ABORT, 'order commercial scope is immutable'); END;
--> statement-breakpoint

ALTER TABLE `campaign_recipients` RENAME TO `_campaign_recipients_legacy`;
--> statement-breakpoint
ALTER TABLE `campaigns` RENAME TO `_campaigns_legacy`;
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_organization_id` ON `campaigns` (`organization_id`,`id`);
--> statement-breakpoint
CREATE INDEX `campaigns_organization_created` ON `campaigns` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `campaigns_organization_status` ON `campaigns` (`organization_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_one_sending_per_organization`
ON `campaigns` (`organization_id`) WHERE `status`='sending';
--> statement-breakpoint
INSERT INTO `campaigns` (`id`,`organization_id`,`message`,`status`,`total`,`sent`,`failed`,`simulated`,`created_by`,`created_at`,`finished_at`)
SELECT `id`,'dolce-pizza',`message`,`status`,`total`,`sent`,`failed`,`simulated`,`created_by`,`created_at`,`finished_at`
FROM `_campaigns_legacy`;
--> statement-breakpoint
CREATE TABLE `campaign_recipients` (
	`organization_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`last_error` text DEFAULT '' NOT NULL,
	PRIMARY KEY (`organization_id`,`campaign_id`,`user_id`),
	FOREIGN KEY (`organization_id`,`campaign_id`) REFERENCES `campaigns`(`organization_id`,`id`) ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `customer_profiles`(`organization_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `campaign_recipients_scope_status` ON `campaign_recipients` (`organization_id`,`campaign_id`,`status`);
--> statement-breakpoint
CREATE INDEX `campaign_recipients_processing_lease` ON `campaign_recipients` (`status`,`lease_expires_at`);
--> statement-breakpoint
INSERT INTO `campaign_recipients` (`organization_id`,`campaign_id`,`user_id`,`phone`,`status`,`sent_at`,`attempts`,`lease_token`,`lease_expires_at`,`last_error`)
SELECT 'dolce-pizza',`campaign_id`,`user_id`,`phone`,`status`,`sent_at`,
       CASE WHEN `status` IN ('sent','simulated','failed') THEN 1 ELSE 0 END,NULL,NULL,''
FROM `_campaign_recipients_legacy`;
--> statement-breakpoint
DROP TABLE `_campaign_recipients_legacy`;
--> statement-breakpoint
DROP TABLE `_campaigns_legacy`;
--> statement-breakpoint
CREATE TRIGGER `campaigns_scope_immutable`
BEFORE UPDATE OF `organization_id` ON `campaigns`
WHEN NEW.`organization_id`<>OLD.`organization_id`
BEGIN SELECT RAISE(ABORT, 'campaign organization scope is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `campaign_recipients_scope_immutable`
BEFORE UPDATE OF `organization_id`,`campaign_id`,`user_id` ON `campaign_recipients`
WHEN NEW.`organization_id`<>OLD.`organization_id`
  OR NEW.`campaign_id`<>OLD.`campaign_id` OR NEW.`user_id`<>OLD.`user_id`
BEGIN SELECT RAISE(ABORT, 'campaign recipient scope is immutable'); END;
--> statement-breakpoint

-- Contract the global identity table after every legacy value is copied. Keeping
-- consent here would invite a future unscoped query to reintroduce the same leak.
DROP INDEX `users_marketing`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `marketing_source`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `marketing_at`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `marketing`;
