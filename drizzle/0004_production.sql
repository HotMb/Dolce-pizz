CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`order_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_operation` ON `notification_outbox` (`operation_id`);--> statement-breakpoint
CREATE INDEX `notification_outbox_pending` ON `notification_outbox` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `notification_outbox_scope_status` ON `notification_outbox` (`organization_id`,`location_id`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `production_events` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`order_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`revision` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`item_id` text,
	`station` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_events_operation` ON `production_events` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `production_events_order_revision` ON `production_events` (`order_id`,`revision`);--> statement-breakpoint
CREATE INDEX `production_events_location_created` ON `production_events` (`organization_id`,`location_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `production_ticket_sequences` (
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`organization_id`, `location_id`),
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `production_tickets` (
	`order_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`ticket_number` integer NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`ticket_payload` text NOT NULL,
	`production_state` text NOT NULL,
	`last_command_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`location_id`,`order_id`) REFERENCES `orders`(`organization_id`,`location_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_tickets_location_number` ON `production_tickets` (`organization_id`,`location_id`,`ticket_number`);--> statement-breakpoint
CREATE INDEX `production_tickets_location_status` ON `production_tickets` (`organization_id`,`location_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_location_id` ON `orders` (`organization_id`,`location_id`,`id`);