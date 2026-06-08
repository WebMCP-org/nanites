CREATE TABLE `installation_model_settings` (
	`github_installation_id` integer PRIMARY KEY NOT NULL,
	`account_id` text,
	`provider` text NOT NULL,
	`provider_label` text NOT NULL,
	`model_id` text NOT NULL,
	`model_name` text NOT NULL,
	`gateway_id` text NOT NULL,
	`byok_alias` text,
	`updated_by_github_user_id` integer,
	`updated_by_github_login` text,
	`last_tested_at` integer,
	`last_test_status` text,
	`last_test_message` text,
	`last_test_latency_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
