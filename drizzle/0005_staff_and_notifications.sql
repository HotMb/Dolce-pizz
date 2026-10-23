CREATE TABLE `staff_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`actor_principal_id` text NOT NULL,
	`target_principal_id` text NOT NULL,
	`role` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`location_id`) REFERENCES `locations`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_audit_scope_created` ON `staff_audit` (`organization_id`,`location_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `provider_message_id` text;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `notification_outbox_lease` ON `notification_outbox` (`status`,`lease_expires_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `notification_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `notification_phone_basis` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `notification_phone_captured_at` text;
--> statement-breakpoint
UPDATE notification_outbox SET updated_at=created_at WHERE updated_at='';
--> statement-breakpoint
-- One-time pilot migration. Existing authenticated legacy administrators become
-- explicit organization owners. Fresh installs provision the owner at setup.
-- No contact verification is inferred for historical orders.
INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at)
SELECT 'bootstrap-owner:dolce-pizza:' || r.user_id,'dolce-pizza',NULL,r.user_id,'owner','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM roles r JOIN users u ON u.id=r.user_id
WHERE r.role='admin'
  AND EXISTS(SELECT 1 FROM organizations WHERE id='dolce-pizza' AND status='active')
  AND NOT EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id='dolce-pizza' AND role='owner' AND location_id IS NULL);
