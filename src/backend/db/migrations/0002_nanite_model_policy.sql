ALTER TABLE `ai_usage_facts` ADD `ai_gateway_id` text;--> statement-breakpoint
ALTER TABLE `nanite_catalog` ADD `model_config_mode` text DEFAULT 'deployment_default' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_catalog` ADD `selected_model_id` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_config_mode` text DEFAULT 'deployment_default' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_selection_source` text DEFAULT 'deployment_default' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_runtime_path` text DEFAULT 'workers_ai_gateway' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_model_id` text DEFAULT 'deepseek/deepseek-v4-pro' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_provider` text DEFAULT 'deepseek' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_model_name` text DEFAULT 'DeepSeek V4 Pro' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_gateway_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_manifest_version_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_resolved_at` integer DEFAULT 0 NOT NULL;