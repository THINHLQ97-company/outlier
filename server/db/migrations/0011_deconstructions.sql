CREATE TABLE "deconstructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"radar_item_id" uuid,
	"source_url" text NOT NULL,
	"platform" text,
	"title" text,
	"duration_sec" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"transcript" text,
	"structure" jsonb,
	"analyzed_by" text,
	"analysis_mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deconstructions_owner_idx" ON "deconstructions" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "deconstructions_item_idx" ON "deconstructions" USING btree ("radar_item_id");