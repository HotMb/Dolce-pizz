-- Site-level availability and pricing overrides keep the organization menu as
-- the master catalog while allowing local stock and pricing decisions.
CREATE TABLE `location_product_overrides` (
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `product_id` text NOT NULL,
  `available` integer,
  `price` integer,
  `xxl` integer,
  `version` integer DEFAULT 1 NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`organization_id`,`location_id`,`product_id`),
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`,`product_id`) REFERENCES `products`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`available` IS NULL OR `available` IN (0,1)),
  CHECK (`price` IS NULL OR (`price` > 0 AND `price` <= 10000)),
  CHECK (`xxl` IS NULL OR (`xxl` > 0 AND `xxl` <= 10000))
);
--> statement-breakpoint
CREATE INDEX `location_product_overrides_location` ON `location_product_overrides` (`organization_id`,`location_id`,`updated_at`);
