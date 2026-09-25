PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`movie_night_id` text NOT NULL,
	`user_id` text,
	`score_x2` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`movie_night_id`) REFERENCES `movie_nights`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_ratings`("id", "movie_night_id", "user_id", "score_x2", "comment", "created_at") SELECT "id", "movie_night_id", "user_id", "score_x2", "comment", "created_at" FROM `ratings`;--> statement-breakpoint
DROP TABLE `ratings`;--> statement-breakpoint
ALTER TABLE `__new_ratings` RENAME TO `ratings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `movie_nights` ADD `revealed_at` integer;