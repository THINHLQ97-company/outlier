ALTER TABLE "deconstructions" ADD COLUMN "content_kind" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "views" integer;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "likes" integer;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "comments" integer;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "shares" integer;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "follower_count" integer;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "body_text" text;