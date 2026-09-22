CREATE TABLE "brand_fanpages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"page_url" text NOT NULL,
	"page_name" text,
	"handle" text,
	"follower_count" integer,
	"topics" jsonb DEFAULT '[]'::jsonb,
	"formats" jsonb DEFAULT '[]'::jsonb,
	"posting_cadence" text,
	"audience_note" text,
	"note" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "personality" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "content_pillars" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "trend_dos" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "trend_donts" jsonb;--> statement-breakpoint
CREATE INDEX "brand_fanpages_brand_idx" ON "brand_fanpages" USING btree ("brand_id");