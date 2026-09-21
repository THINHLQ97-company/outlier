CREATE TABLE "remakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"deconstruction_id" uuid,
	"format" text DEFAULT 'video_script' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"draft" text,
	"guardrail_json" jsonb,
	"revisions_json" jsonb DEFAULT '[]'::jsonb,
	"source_url" text,
	"source_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "remakes_owner_idx" ON "remakes" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "remakes_brand_idx" ON "remakes" USING btree ("brand_id");