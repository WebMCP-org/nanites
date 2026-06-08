CREATE TABLE `installation_ai_provider_keys` (
	`github_installation_id` integer NOT NULL,
	`provider` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`key_last4` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`github_installation_id`, `provider`),
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
