PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`movie_id` text NOT NULL,
	`suggested_by` text,
	`dedupe_key` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_suggestions`("id", "group_id", "movie_id", "suggested_by", "dedupe_key", "note", "status", "created_at") SELECT "id", "group_id", "movie_id", "suggested_by", "dedupe_key", "note", "status", "created_at" FROM `suggestions`;--> statement-breakpoint
DROP TABLE `suggestions`;--> statement-breakpoint
ALTER TABLE `__new_suggestions` RENAME TO `suggestions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_group_dedupe` ON `suggestions` (`group_id`,`dedupe_key`);