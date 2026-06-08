ALTER TABLE `ai_usage_facts` ADD `ai_gateway_id` text;--> statement-breakpoint
ALTER TABLE `nanite_catalog` ADD `model_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_runtime_path` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_model_id` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_provider` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_model_name` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `effective_gateway_id` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_manifest_version_id` text;--> statement-breakpoint
ALTER TABLE `nanite_run_facts` ADD `model_resolved_at` integer;
