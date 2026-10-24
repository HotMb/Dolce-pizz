-- Provider store mappings and an append-only inbox make aggregator webhooks
-- replay-safe before an order is exposed to the POS/KDS.
CREATE TABLE `delivery_integrations` (
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `provider` text NOT NULL,
  `external_store_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  PRIMARY KEY (`organization_id`,`location_id`,`provider`),
  UNIQUE (`provider`,`external_store_id`),
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`provider` IN ('uber_eats')),
  CHECK (`status` IN ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE `delivery_inbox` (
  `provider` text NOT NULL,
  `event_id` text NOT NULL,
  `external_order_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `event_type` text NOT NULL,
  `payload_hash` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `received_at` text NOT NULL,
  `processed_at` text,
  `error` text NOT NULL DEFAULT '',
  PRIMARY KEY (`provider`,`event_id`),
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` IN ('pending','processed','failed'))
);
--> statement-breakpoint
CREATE INDEX `delivery_inbox_order` ON `delivery_inbox` (`organization_id`,`location_id`,`provider`,`external_order_id`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `external_provider` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `external_order_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_external_id` ON `orders` (`organization_id`,`external_provider`,`external_order_id`);
