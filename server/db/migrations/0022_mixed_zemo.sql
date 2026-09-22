ALTER TABLE "brand_fanpages" ADD COLUMN "meta_page_id" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_enc" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_last_post_count" integer;