-- A ready order produces a customer-facing pickup ticket in addition to the
-- kitchen and receipt tickets. Extend the outbox constraint without losing
-- queued jobs from existing installations.
CREATE TABLE `print_outbox_ready_ticket_new` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `order_id` text NOT NULL,
  `job_type` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `attempts` integer NOT NULL DEFAULT 0,
  `available_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `printed_at` text,
  `lease_token` text,
  `lease_expires_at` text,
  `last_error` text,
  `provider_job_id` text,
  FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`job_type` IN ('kitchen_ticket','customer_receipt','ready_ticket')),
  CHECK (`status` IN ('pending','printing','printed','failed','unknown'))
);
--> statement-breakpoint
INSERT INTO `print_outbox_ready_ticket_new` (`id`,`operation_id`,`organization_id`,`location_id`,`order_id`,`job_type`,`payload`,`status`,`attempts`,`available_at`,`created_at`,`updated_at`,`printed_at`,`lease_token`,`lease_expires_at`,`last_error`,`provider_job_id`)
SELECT `id`,`operation_id`,`organization_id`,`location_id`,`order_id`,`job_type`,`payload`,`status`,`attempts`,`available_at`,`created_at`,`updated_at`,`printed_at`,`lease_token`,`lease_expires_at`,`last_error`,`provider_job_id` FROM `print_outbox`;
--> statement-breakpoint
DROP TABLE `print_outbox`;
--> statement-breakpoint
ALTER TABLE `print_outbox_ready_ticket_new` RENAME TO `print_outbox`;
--> statement-breakpoint
CREATE UNIQUE INDEX `print_outbox_operation` ON `print_outbox` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `print_outbox_pending` ON `print_outbox` (`status`,`available_at`);
--> statement-breakpoint
CREATE INDEX `print_outbox_scope_status` ON `print_outbox` (`organization_id`,`location_id`,`status`,`available_at`);
--> statement-breakpoint
CREATE INDEX `print_outbox_lease` ON `print_outbox` (`status`,`lease_expires_at`);
