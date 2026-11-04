-- Rollback after stopping repair: DROP TABLE image_pending_updates; DROP TABLE image_cache_entries;
-- Keep cached files and volumes intact. This migration has not been applied.
CREATE TABLE "image_cache_entries" (
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url_hash" text PRIMARY KEY NOT NULL,
	"local_url" text,
	"dead" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_pending_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_table" text NOT NULL,
	"target_column" text NOT NULL,
	"target_id" uuid NOT NULL,
	"post_id" text DEFAULT '' NOT NULL,
	"source_url" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "image_pending_target_idx" ON "image_pending_updates" USING btree ("target_table","target_column","target_id","post_id");