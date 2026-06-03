ALTER TABLE `nanite_run_facts`
ADD `triggered_by_github_user_id` integer;
--> statement-breakpoint
ALTER TABLE `nanite_run_facts`
ADD `triggered_by_github_login` text;
--> statement-breakpoint
ALTER TABLE `ai_usage_facts`
ADD `provider_billed_total_cost_usd_micros` integer;
