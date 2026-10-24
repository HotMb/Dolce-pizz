CREATE TABLE `payment_refunds` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `payment_id` text NOT NULL,
  `order_id` text NOT NULL,
  `amount` integer NOT NULL CHECK (`amount` > 0),
  `reason` text NOT NULL,
  `status` text NOT NULL DEFAULT 'recorded' CHECK (`status` in ('recorded','pending_provider','completed','rejected')),
  `provider_reference` text,
  `actor_user_id` text NOT NULL,
  `created_at` text NOT NULL,
  UNIQUE (`organization_id`,`location_id`,`id`),
  FOREIGN KEY (`organization_id`,`location_id`,`payment_id`) REFERENCES `payments`(`organization_id`,`location_id`,`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX `payment_refunds_order` ON `payment_refunds` (`organization_id`,`location_id`,`order_id`,`created_at`);--> statement-breakpoint
