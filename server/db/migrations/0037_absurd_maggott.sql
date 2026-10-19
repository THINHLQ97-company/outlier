CREATE TABLE "ad_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fanpage_id" uuid NOT NULL,
	"post_id" text NOT NULL,
	"post_message" text,
	"post_permalink" text,
	"post_thumbnail_url" text,
	"note" text,
	"requested_by" text NOT NULL,
	"assignee" text,
	"status" text DEFAULT 'cho_chay' NOT NULL,
	"status_by" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fanpage_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fanpage_id" uuid NOT NULL,
	"post_id" text NOT NULL,
	"message" text,
	"permalink" text,
	"thumbnail_url" text,
	"media_type" text,
	"created_time" timestamp with time zone,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"ad_active" boolean DEFAULT false NOT NULL,
	"ad_count" integer DEFAULT 0 NOT NULL,
	"ad_spend" real,
	"ad_currency" text,
	"ad_impressions" integer,
	"ad_reach" integer,
	"ad_ids" jsonb,
	"ad_first_seen_at" timestamp with time zone,
	"ad_last_seen_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_posts_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_ads_status" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_ads_note" text;--> statement-breakpoint
CREATE INDEX "ad_orders_status_idx" ON "ad_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_orders_post_idx" ON "ad_orders" USING btree ("fanpage_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fanpage_posts_fanpage_post_uniq" ON "fanpage_posts" USING btree ("fanpage_id","post_id");--> statement-breakpoint
CREATE INDEX "fanpage_posts_fanpage_idx" ON "fanpage_posts" USING btree ("fanpage_id");