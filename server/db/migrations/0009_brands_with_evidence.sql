CREATE TABLE "brand_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_url" text,
	"title" text,
	"extracted_text" text DEFAULT '' NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"is_shared" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"sells" jsonb,
	"audience" jsonb,
	"tone_of_voice" jsonb,
	"addressing" jsonb,
	"banned_terms" jsonb,
	"allowed_claims" jsonb,
	"ingest_status" text DEFAULT 'empty' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brand_sources_brand_idx" ON "brand_sources" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner");