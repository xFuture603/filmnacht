ALTER TABLE `movie_nights` ADD `organizer_id` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
-- Only owners could schedule until now: every existing night is its group owner's.
UPDATE `movie_nights` SET `organizer_id` = (SELECT `owner_id` FROM `groups` WHERE `groups`.`id` = `movie_nights`.`group_id`);
