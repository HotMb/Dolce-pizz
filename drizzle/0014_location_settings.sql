-- Opening hours, capacity and loyalty settings belong to a pickup site.
-- Keep the organization row as a compatibility/default template for older tools.
CREATE TABLE `location_config` (
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `value` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  PRIMARY KEY (`organization_id`,`location_id`),
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_config_org` ON `location_config` (`organization_id`);
