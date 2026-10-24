CREATE TABLE IF NOT EXISTS `call_interactions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `staff_user_id` text NOT NULL,
  `customer_user_id` text,
  `phone_hash` text NOT NULL,
  `order_id` text,
  `outcome` text NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`staff_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`organization_id`,`customer_user_id`) REFERENCES `customer_profiles`(`organization_id`,`user_id`) ON DELETE SET NULL,
  FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON DELETE SET NULL,
  CHECK (`outcome` IN ('order_created','customer_found','no_answer','callback_requested','other'))
);
CREATE INDEX `call_interactions_scope_created` ON `call_interactions` (`organization_id`,`location_id`,`created_at`);
CREATE INDEX `call_interactions_phone` ON `call_interactions` (`organization_id`,`phone_hash`,`created_at`);
