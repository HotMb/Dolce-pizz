-- Domains are registered in the tenant database, but only DNS-verified rows
-- are accepted by the public tenant resolver.
CREATE TABLE `tenant_domains` (
  `host` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `verification_token_hash` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `verified_at` text,
  FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`status` IN ('pending','verified'))
);
--> statement-breakpoint
CREATE INDEX `tenant_domains_scope` ON `tenant_domains` (`organization_id`,`location_id`,`status`);
