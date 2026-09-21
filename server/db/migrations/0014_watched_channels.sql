CREATE TABLE "channel_seen_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"platform" text NOT NULL,
	"channel_url" text NOT NULL,
	"channel_key" text,
	"channel_name" text,
	"follower_count" integer,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scan_at" timestamp with time zone,
	"last_job_id" uuid,
	"last_new_count" integer DEFAULT 0 NOT NULL,
	"scan_status" text DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radar_items" ADD COLUMN "is_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radar_jobs" ADD COLUMN "watched_channel_id" uuid;--> statement-breakpoint
CREATE INDEX "channel_seen_chan_idx" ON "channel_seen_items" USING btree ("channel_id","item_key");--> statement-breakpoint
CREATE INDEX "watched_channels_owner_idx" ON "watched_channels" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "watched_channels_chan_idx" ON "watched_channels" USING btree ("platform","channel_url");