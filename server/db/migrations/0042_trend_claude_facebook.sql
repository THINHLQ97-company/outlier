ALTER TABLE "trend_workflow_items" ADD COLUMN "facebook" jsonb;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "content_path" text;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "facebook_reason" text;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "facebook_source_url" text;--> statement-breakpoint
ALTER TABLE "trend_workflow_runs" ADD COLUMN "apify_posts" integer DEFAULT 0 NOT NULL;