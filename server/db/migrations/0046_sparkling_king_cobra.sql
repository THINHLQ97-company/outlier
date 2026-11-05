ALTER TABLE "brand_fanpages" ADD COLUMN "content_direction_url" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "content_direction_title" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "content_direction_text" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "content_direction_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "content_direction_error" text;