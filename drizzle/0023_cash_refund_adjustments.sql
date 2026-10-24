CREATE TABLE IF NOT EXISTS `cash_shift_adjustments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `shift_id` text,
  `refund_id` text NOT NULL,
  `amount` integer NOT NULL,
  `method` text NOT NULL,
  `reason` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`,`location_id`,`shift_id`) REFERENCES `cash_shifts`(`organization_id`,`location_id`,`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`organization_id`,`location_id`,`refund_id`) REFERENCES `payment_refunds`(`organization_id`,`location_id`,`id`) ON DELETE RESTRICT,
  CHECK (`amount` < 0),
  CHECK (`method` IN ('cash','card'))
);
CREATE UNIQUE INDEX IF NOT EXISTS `cash_shift_adjustments_refund` ON `cash_shift_adjustments` (`organization_id`,`location_id`,`refund_id`);
CREATE INDEX IF NOT EXISTS `cash_shift_adjustments_shift` ON `cash_shift_adjustments` (`organization_id`,`location_id`,`shift_id`,`created_at`);
