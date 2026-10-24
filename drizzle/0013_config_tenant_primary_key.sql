-- A tenant must own its own settings row. The legacy table used id=1 as a
-- global primary key, which made a second organization impossible to onboard.
CREATE TABLE `config_tenant_new` (
  `id` integer NOT NULL,
  `value` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `organization_id` text NOT NULL,
  PRIMARY KEY (`organization_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `config_tenant_new` (`id`,`value`,`version`,`organization_id`)
SELECT `id`,`value`,`version`,`organization_id` FROM `config` WHERE `organization_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `config`;
--> statement-breakpoint
ALTER TABLE `config_tenant_new` RENAME TO `config`;
--> statement-breakpoint
CREATE UNIQUE INDEX `config_organization` ON `config` (`organization_id`);
--> statement-breakpoint
CREATE TRIGGER `config_scope_insert`
BEFORE INSERT ON `config`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid configuration organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `config_scope_update`
BEFORE UPDATE OF `organization_id` ON `config`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid configuration organization scope'); END;
