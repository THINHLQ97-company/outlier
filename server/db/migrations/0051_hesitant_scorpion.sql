ALTER TABLE "group_weekly_reports" ADD COLUMN "posts_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "group_weekly_reports" ADD COLUMN "admin_notes" text;