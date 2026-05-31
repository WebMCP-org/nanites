CREATE TABLE `installations` (
	`id` text PRIMARY KEY NOT NULL,
	`github_installation_id` integer NOT NULL,
	`github_account_id` integer NOT NULL,
	`github_account_login` text NOT NULL,
	`github_account_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installations_github_installation_id_unique` ON `installations` (`github_installation_id`);