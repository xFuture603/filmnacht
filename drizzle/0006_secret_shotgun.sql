ALTER TABLE `movie_nights` ADD `rating_open_mailed_at` integer;--> statement-breakpoint
ALTER TABLE `movie_nights` ADD `rating_reminder_mailed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `rating_mails` integer DEFAULT true NOT NULL;