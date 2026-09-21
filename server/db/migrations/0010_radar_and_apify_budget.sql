CREATE TABLE "apify_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apify_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"actor_id" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"channel_key" text NOT NULL,
	"channel_name" text,
	"follower_count" integer,
	"median_views" integer,
	"median_likes" integer,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"item_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"cover_url" text,
	"duration_sec" integer,
	"published_at" timestamp with time zone,
	"channel_key" text,
	"channel_name" text,
	"follower_count" integer,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"metrics_source" text DEFAULT 'scan' NOT NULL,
	"outperform_score" integer,
	"confidence" text DEFAULT 'low' NOT NULL,
	"score_breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"brand_id" uuid,
	"query" text NOT NULL,
	"query_kind" text DEFAULT 'keyword' NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scanned_count" integer DEFAULT 0 NOT NULL,
	"enriched_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "apify_usage_day_idx" ON "apify_usage" USING btree ("day");--> statement-breakpoint
CREATE INDEX "channel_baselines_chan_idx" ON "channel_baselines" USING btree ("platform","channel_key");--> statement-breakpoint
CREATE INDEX "radar_items_job_idx" ON "radar_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "radar_items_score_idx" ON "radar_items" USING btree ("outperform_score");--> statement-breakpoint
CREATE INDEX "radar_jobs_owner_idx" ON "radar_jobs" USING btree ("owner");