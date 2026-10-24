-- Append-only master-menu history. Order snapshots remain the source of truth for past sales.
CREATE TABLE `menu_product_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `product_id` text NOT NULL,
  `product_version` integer NOT NULL,
  `action` text NOT NULL,
  `snapshot` text NOT NULL,
  `actor_id` text NOT NULL,
  `changed_at` text NOT NULL,
  UNIQUE (`organization_id`,`product_id`,`product_version`),
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`action` IN ('created','updated','archived','deleted','photo_updated'))
);
--> statement-breakpoint
CREATE INDEX `menu_product_revisions_scope` ON `menu_product_revisions` (`organization_id`,`product_id`,`changed_at`);
--> statement-breakpoint
CREATE TRIGGER `menu_product_revisions_immutable_update`
BEFORE UPDATE ON `menu_product_revisions`
BEGIN SELECT RAISE(ABORT, 'menu product revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `menu_product_revisions_immutable_delete`
BEFORE DELETE ON `menu_product_revisions`
BEGIN SELECT RAISE(ABORT, 'menu product revisions are immutable'); END;
