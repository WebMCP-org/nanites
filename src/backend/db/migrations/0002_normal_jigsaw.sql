CREATE TABLE `account_entitlements` (
	`account_id` text PRIMARY KEY NOT NULL,
	`plan_id` text DEFAULT 'internal' NOT NULL,
	`billing_provider` text,
	`external_billing_account_id` text,
	`seat_cap` integer,
	`repo_cap` integer,
	`run_cap` integer,
	`ai_token_allowance` integer,
	`browser_verification_allowance` integer,
	`ai_token_overage_count` integer DEFAULT 0 NOT NULL,
	`browser_verification_overage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_installation_repository_map` (
	`github_installation_id` integer NOT NULL,
	`github_repository_id` integer NOT NULL,
	PRIMARY KEY(`github_installation_id`, `github_repository_id`),
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`github_installation_id` integer NOT NULL,
	`status` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`suspended_at` integer,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_installations_github_installation_id_unique` ON `account_installations` (`github_installation_id`);--> statement-breakpoint
CREATE TABLE `account_people` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`github_user_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`relationship` text NOT NULL,
	`last_signed_in_at` integer,
	`last_active_at` integer,
	`first_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_people_account_user_unique` ON `account_people` (`account_id`,`github_user_id`);--> statement-breakpoint
CREATE TABLE `account_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`github_installation_id` integer NOT NULL,
	`github_repository_id` integer NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`owner_login` text NOT NULL,
	`default_branch` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`permission_tier` text,
	`config_source` text,
	`config_enabled` integer DEFAULT true NOT NULL,
	`configured_nanite_count` integer DEFAULT 0 NOT NULL,
	`mcp_server_count` integer DEFAULT 0 NOT NULL,
	`missing_soul_document_count` integer DEFAULT 0 NOT NULL,
	`missing_skill_document_count` integer DEFAULT 0 NOT NULL,
	`broken_prompt_config` integer DEFAULT false NOT NULL,
	`last_config_fetched_at` integer,
	`last_viewed_at` integer,
	`last_run_at` integer,
	`last_active_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_repositories_account_repo_unique` ON `account_repositories` (`account_id`,`github_repository_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`github_account_id` integer NOT NULL,
	`github_account_login` text NOT NULL,
	`github_account_type` text NOT NULL,
	`github_account_avatar_url` text,
	`last_active_at` integer,
	`first_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_github_account_id_unique` ON `accounts` (`github_account_id`);--> statement-breakpoint
CREATE TABLE `ai_pricing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effective_at` integer NOT NULL,
	`input_token_cost_per_million_usd_micros` integer NOT NULL,
	`cached_input_token_cost_per_million_usd_micros` integer,
	`output_token_cost_per_million_usd_micros` integer NOT NULL,
	`reasoning_token_cost_per_million_usd_micros` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_pricing_snapshots_provider_model_effective_unique` ON `ai_pricing_snapshots` (`provider`,`model`,`effective_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`github_installation_id` integer NOT NULL,
	`github_repository_id` integer,
	`run_key` text,
	`request_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`session_affinity` text,
	`is_continuation` integer DEFAULT false NOT NULL,
	`step_count` integer DEFAULT 1 NOT NULL,
	`finish_reason` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`reasoning_tokens` integer,
	`cached_input_tokens` integer,
	`cache_write_tokens` integer,
	`raw_usage_json` text,
	`provider_metadata_json` text,
	`estimated_input_cost_usd_micros` integer,
	`estimated_output_cost_usd_micros` integer,
	`estimated_total_cost_usd_micros` integer,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_facts_request_id_unique` ON `ai_usage_facts` (`request_id`);--> statement-breakpoint
CREATE TABLE `auth_funnel_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`github_installation_id` integer,
	`github_repository_id` integer,
	`github_user_id` integer,
	`github_login` text,
	`event_type` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nanite_run_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`github_installation_id` integer NOT NULL,
	`github_repository_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`run_key` text NOT NULL,
	`nanite_id` text NOT NULL,
	`variant` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`trigger_pull_request_number` integer,
	`status` text NOT NULL,
	`conclusion` text,
	`phase` text NOT NULL,
	`task` text NOT NULL,
	`summary` text,
	`config_source` text,
	`implicit_failure_reason` text,
	`missing_exit_tool_reminder_count` integer DEFAULT 0 NOT NULL,
	`total_message_count` integer DEFAULT 0 NOT NULL,
	`runtime_activity_part_count` integer DEFAULT 0 NOT NULL,
	`reasoning_block_count` integer DEFAULT 0 NOT NULL,
	`tool_invocation_count` integer DEFAULT 0 NOT NULL,
	`tool_failure_count` integer DEFAULT 0 NOT NULL,
	`model_turn_count` integer DEFAULT 0 NOT NULL,
	`continuation_turn_count` integer DEFAULT 0 NOT NULL,
	`workspace_file_count` integer,
	`workspace_directory_count` integer,
	`workspace_total_bytes` integer,
	`workspace_hydration_duration_ms` integer,
	`workspace_hydration_heartbeat_count` integer,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`last_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nanite_run_facts_installation_repo_run_unique` ON `nanite_run_facts` (`github_installation_id`,`github_repository_id`,`run_key`);--> statement-breakpoint
CREATE TABLE `platform_usage_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`github_installation_id` integer,
	`github_repository_id` integer,
	`run_key` text,
	`category` text NOT NULL,
	`event_key` text NOT NULL,
	`status` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `account_installations`(`github_installation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
