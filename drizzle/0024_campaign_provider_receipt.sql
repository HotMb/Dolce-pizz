ALTER TABLE `campaign_recipients` ADD COLUMN `provider_message_id` text NOT NULL DEFAULT '';
CREATE INDEX `campaign_recipients_provider_receipt` ON `campaign_recipients` (`organization_id`,`campaign_id`,`provider_message_id`);
