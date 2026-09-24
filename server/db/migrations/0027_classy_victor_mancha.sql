ALTER TABLE "deconstructions" ADD COLUMN "comments_json" jsonb;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "audience_insight" jsonb;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "comments_fetched_at" timestamp with time zone;