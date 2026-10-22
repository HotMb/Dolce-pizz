CREATE TABLE `campaign_recipients` (
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`campaign_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `campaign_recipients_status` ON `campaign_recipients` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`allergens` text DEFAULT '[]' NOT NULL,
	`meat` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`extra` integer DEFAULT 1 NOT NULL,
	`available` integer DEFAULT 1 NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_photos` (
	`product_id` text NOT NULL,
	`version` text NOT NULL,
	`width` integer NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`product_id`, `version`, `width`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `ingredients` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `allergens` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `allergens_checked` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `tagline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `photo` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `spicy` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `marketing` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `marketing_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `marketing_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `users_marketing` ON `users` (`marketing`);--> statement-breakpoint
-- Opening data for databases created before this migration (a new database gets it from ensureSeed).
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('pate','Pâte à pizza','["gluten"]','','',0,1,1,0);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-tomate','Sauce tomate','[]','','',0,1,0,1);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('creme-fraiche','Crème fraîche','["lait"]','','',0,1,0,2);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('creme-truffee','Crème truffée','["lait"]','','',0,1,0,3);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('mozzarella','Mozzarella','["lait"]','','',1,1,0,4);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('chevre','Chèvre','["lait"]','','',1,1,0,5);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('bleu','Bleu','["lait"]','','',1,1,0,6);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('emmental','Emmental','["lait"]','','',1,1,0,7);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('raclette','Raclette','["lait"]','','',1,1,0,8);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('parmesan','Parmesan','["lait"]','','',1,1,0,9);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('boursin','Boursin','["lait"]','','',1,1,0,10);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('olives','Olives noires','[]','','',1,1,0,11);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('oignons-rouges','Oignons rouges','[]','','',1,1,0,12);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('oignons','Oignons','[]','','',1,1,0,13);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('tomates-cerises','Tomates cerises','[]','','',1,1,0,14);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('poivrons','Poivrons','[]','','',1,1,0,15);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('champignons','Champignons','[]','','',1,1,0,16);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('pomme-de-terre','Pomme de terre','[]','','',1,1,0,17);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('roquette','Roquette','[]','','',1,1,0,18);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('origan','Origan','[]','','',0,1,0,19);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('miel','Miel','[]','','',1,1,0,20);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('oeuf','Œuf','["oeufs"]','','',1,1,0,21);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('thon','Thon','["poissons"]','','',1,1,0,22);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('saumon-fume','Saumon fumé','["poissons"]','','',1,1,0,23);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('anchois','Anchois','["poissons"]','','',1,1,0,24);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('jambon-dinde','Jambon de dinde','[]','volaille','',1,1,0,25);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('jambon','Jambon','[]','porc','',1,1,0,26);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('lardons','Lardons fumés','[]','porc','',1,1,0,27);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('chorizo','Chorizo','[]','porc','',1,1,0,28);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('merguez','Merguez','[]','boeuf','',1,1,0,29);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('boeuf-hache','Bœuf haché','[]','boeuf','',1,1,0,30);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('poulet','Poulet','[]','volaille','',1,1,0,31);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-gruyere','Sauce gruyère','["lait"]','','',0,1,0,32);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-curry','Sauce curry','["moutarde"]','','',0,1,0,33);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-barbecue','Sauce barbecue','["moutarde"]','','',0,1,0,34);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-algerienne','Sauce algérienne','["oeufs","moutarde"]','','',0,1,0,35);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-thai','Sauce thaï','[]','','',0,1,0,36);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('pesto','Sauce pesto maison','["lait","fruits-a-coque"]','','',0,1,0,37);--> statement-breakpoint
INSERT OR IGNORE INTO `ingredients`(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES('sauce-tn','Sauce TN','[]','','',0,1,0,38);--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","olives"]',allergens='[]',tagline='Simple, efficace, indémodable.',photo='static',spicy=0,sort=0 WHERE id='margarita';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","chevre","bleu","emmental"]',allergens='[]',tagline='Quatre fromages, zéro compromis.',photo='static',spicy=0,sort=1 WHERE id='4-fromages';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","oignons-rouges","tomates-cerises","olives","thon"]',allergens='[]',tagline='Un air du Sud dans chaque part.',photo='static',spicy=0,sort=2 WHERE id='thon';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","merguez","poivrons","olives","oeuf"]',allergens='[]',tagline='Épicée, généreuse, pleine de soleil.',photo='static',spicy=0,sort=3 WHERE id='orientale';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","jambon-dinde","chorizo","poivrons","oeuf"]',allergens='[]',tagline='Du caractère, et un œuf pour finir.',photo='static',spicy=0,sort=4 WHERE id='chorizo';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","champignons","jambon-dinde"]',allergens='[]',tagline='La reine des classiques.',photo='static',spicy=0,sort=5 WHERE id='reine';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","oignons-rouges","tomates-cerises","olives","poivrons"]',allergens='[]',tagline='Colorée, fraîche et bien garnie.',photo='static',spicy=0,sort=6 WHERE id='vegetarienne';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","boeuf-hache","poivrons","oignons-rouges"]',allergens='[]',tagline='Le goût de la sauce du dimanche.',photo='static',spicy=0,sort=7 WHERE id='bolognaise';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","boeuf-hache","oeuf","merguez"]',allergens='[]',tagline='Bœuf, merguez et œuf : le trio royal.',photo='static',spicy=0,sort=8 WHERE id='royale';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","chevre","miel"]',allergens='[]',tagline='Douce, fondante, un brin sucrée.',photo='static',spicy=0,sort=9 WHERE id='chevre-miel';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","champignons","boursin"]',allergens='[]',tagline='Crémeuse et pleine d’herbes.',photo='static',spicy=0,sort=10 WHERE id='boursin';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","pomme-de-terre","olives","oignons"]',allergens='[]',tagline='Poulet et pommes de terre, réconfort garanti.',photo='static',spicy=0,sort=11 WHERE id='chicken';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","saumon-fume","pomme-de-terre","oignons"]',allergens='[]',tagline='Fumée, crémeuse et raffinée.',photo='static',spicy=0,sort=12 WHERE id='saumon';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","jambon","pomme-de-terre","olives","oignons"]',allergens='[]',tagline='Toute la générosité de la campagne.',photo='static',spicy=0,sort=13 WHERE id='paysanne';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","lardons","pomme-de-terre","raclette"]',allergens='[]',tagline='Raclette et lardons, l’hiver toute l’année.',photo='static',spicy=0,sort=14 WHERE id='savoyarde';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","lardons","jambon","champignons","origan"]',allergens='[]',tagline='Un parfum de sous-bois.',photo='static',spicy=0,sort=15 WHERE id='forestiere';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","poivrons","olives","sauce-gruyere","pomme-de-terre"]',allergens='[]',tagline='Fondante et gourmande, sauce gruyère.',photo='static',spicy=0,sort=16 WHERE id='boisee';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","champignons","sauce-curry"]',allergens='[]',tagline='Une touche de curry qui fait voyager.',photo='static',spicy=0,sort=17 WHERE id='indienne';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","poulet","merguez","boeuf-hache","poivrons","sauce-barbecue"]',allergens='[]',tagline='Pour les très grosses faims.',photo='static',spicy=1,sort=18 WHERE id='cannibale';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","boeuf-hache","pomme-de-terre","oignons","chevre"]',allergens='[]',tagline='Bœuf, chèvre et crème : le combo fort.',photo='',spicy=0,sort=19 WHERE id='cream-beef';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","merguez","poivrons","oignons","sauce-algerienne"]',allergens='[]',tagline='Ça pique juste ce qu’il faut.',photo='',spicy=0,sort=20 WHERE id='salsa';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","poulet","poivrons","olives","sauce-thai"]',allergens='[]',tagline='Sucrée, épicée, dépaysante.',photo='',spicy=0,sort=21 WHERE id='thai';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella"]',allergens='[]',tagline='Pliée, dorée, garnie à votre goût.',photo='',spicy=0,sort=22,description='Sauce tomate, mozzarella, poulet ou bœuf haché ou jambon de dinde au choix.',options='["Poulet","Bœuf haché","Jambon de dinde"]' WHERE id='calzone';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","poulet","pesto"]',allergens='[]',tagline='Pesto maison, tout en fraîcheur.',photo='',spicy=0,sort=23 WHERE id='pesto';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-truffee","mozzarella","jambon-dinde","roquette","parmesan"]',allergens='[]',tagline='Truffe, roquette, parmesan : la chic.',photo='static',spicy=0,sort=24 WHERE id='tartuffo';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","poulet","olives","sauce-tn"]',allergens='[]',tagline='Sauce TN, pour les audacieux.',photo='',spicy=0,sort=25 WHERE id='pimiento';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","anchois"]',allergens='[]',tagline='Anchois et tomate, l’Italie sans détour.',photo='',spicy=0,sort=26 WHERE id='napoli';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","creme-fraiche","mozzarella","emmental","raclette","sauce-gruyere"]',allergens='[]',tagline='Le rêve des amoureux du fromage.',photo='',spicy=0,sort=27 WHERE id='fromagesque';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","merguez","chorizo","poivrons","parmesan"]',allergens='[]',tagline='Chorizo et merguez : la diabolique.',photo='',spicy=0,sort=28 WHERE id='diavulo';--> statement-breakpoint
UPDATE `products` SET ingredients='["pate","sauce-tomate","mozzarella","champignons","jambon-dinde"]',allergens='[]',tagline='',photo='',spicy=0,sort=29 WHERE id='kids';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='["gluten","oeufs","lait","fruits-a-coque","soja"]',tagline='',photo='',spicy=0,sort=30 WHERE id='daim';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='["gluten","oeufs","lait"]',tagline='',photo='',spicy=0,sort=31 WHERE id='tiramisu';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='["lait","oeufs","gluten","soja","fruits-a-coque"]',tagline='',photo='',spicy=0,sort=32 WHERE id='ben-jerrys';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='["lait","oeufs"]',tagline='',photo='',spicy=0,sort=33 WHERE id='haagen-dazs';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='["lait","gluten","soja"]',tagline='',photo='',spicy=0,sort=34 WHERE id='mars';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='[]',tagline='',photo='',spicy=0,sort=35 WHERE id='canette';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='[]',tagline='',photo='',spicy=0,sort=36 WHERE id='cristaline';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='[]',tagline='',photo='',spicy=0,sort=37 WHERE id='caprisun';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='[]',tagline='',photo='',spicy=0,sort=38 WHERE id='coca';--> statement-breakpoint
UPDATE `products` SET ingredients='[]',allergens='[]',tagline='',photo='',spicy=0,sort=39 WHERE id='oasis';
