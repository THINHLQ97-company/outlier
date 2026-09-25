ALTER TABLE "brand_fanpages" ADD COLUMN "meta_user_token_enc" text;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_never_expires" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_renewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_fanpages" ADD COLUMN "meta_token_note" text;