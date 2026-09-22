CREATE TABLE `config` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_order` ON `events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`delta` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_user` ON `ledger` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_order_kind` ON `ledger` (`order_id`,`kind`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`items` text NOT NULL,
	`note` text NOT NULL,
	`slot` text NOT NULL,
	`subtotal` integer NOT NULL,
	`discount` integer NOT NULL,
	`total` integer NOT NULL,
	`redeemed` integer NOT NULL,
	`earned` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency` ON `orders` (`user_id`,`idempotency`);--> statement-breakpoint
CREATE INDEX `orders_user_created` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_slot_status` ON `orders` (`slot`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`xxl` integer,
	`available` integer DEFAULT 1 NOT NULL,
	`options` text
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL
);
