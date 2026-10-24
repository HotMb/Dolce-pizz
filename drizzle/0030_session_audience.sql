ALTER TABLE `sessions` ADD COLUMN `audience` text NOT NULL DEFAULT 'customer' CHECK (`audience` IN ('customer','staff'));
--> statement-breakpoint
CREATE INDEX `sessions_audience` ON `sessions` (`audience`,`expires_at`);
