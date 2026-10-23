-- Move the first catalogue and configuration rows into an explicit tenant
-- scope. Existing Dolce data is assigned to Dolce; no other tenant is seeded.
ALTER TABLE `config` ADD `organization_id` text;
--> statement-breakpoint
UPDATE `config` SET `organization_id`='dolce-pizza' WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `config_organization` ON `config` (`organization_id`);
--> statement-breakpoint
ALTER TABLE `products` ADD `organization_id` text;
--> statement-breakpoint
UPDATE `products` SET `organization_id`='dolce-pizza' WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `products_organization_id` ON `products` (`organization_id`,`id`);
--> statement-breakpoint
ALTER TABLE `ingredients` ADD `organization_id` text;
--> statement-breakpoint
UPDATE `ingredients` SET `organization_id`='dolce-pizza' WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredients_organization_id` ON `ingredients` (`organization_id`,`id`);
--> statement-breakpoint
ALTER TABLE `product_photos` ADD `organization_id` text;
--> statement-breakpoint
UPDATE `product_photos`
SET `organization_id`=(SELECT `organization_id` FROM `products` WHERE `products`.`id`=`product_photos`.`product_id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `product_photos_organization_product` ON `product_photos` (`organization_id`,`product_id`,`version`,`width`);
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
--> statement-breakpoint
CREATE TRIGGER `products_scope_insert`
BEFORE INSERT ON `products`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid product organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `products_scope_update`
BEFORE UPDATE OF `organization_id` ON `products`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid product organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `ingredients_scope_insert`
BEFORE INSERT ON `ingredients`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid ingredient organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `ingredients_scope_update`
BEFORE UPDATE OF `organization_id` ON `ingredients`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(SELECT 1 FROM `organizations` WHERE `id`=NEW.`organization_id`)
BEGIN SELECT RAISE(ABORT, 'invalid ingredient organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `product_photos_scope_insert`
BEFORE INSERT ON `product_photos`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(
  SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `organization_id`=NEW.`organization_id`
)
BEGIN SELECT RAISE(ABORT, 'invalid product photo organization scope'); END;
--> statement-breakpoint
CREATE TRIGGER `product_photos_scope_update`
BEFORE UPDATE OF `organization_id`,`product_id` ON `product_photos`
WHEN NEW.`organization_id` IS NULL OR NOT EXISTS(
  SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `organization_id`=NEW.`organization_id`
)
BEGIN SELECT RAISE(ABORT, 'invalid product photo organization scope'); END;
--> statement-breakpoint
DROP INDEX `orders_idempotency`;
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_scope` ON `orders` (`organization_id`,`location_id`,`user_id`,`idempotency`);
