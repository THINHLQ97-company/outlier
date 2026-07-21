CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'reference' NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "script_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "signal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "origin" text DEFAULT 'pipeline' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "is_shared" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "truc" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "prompt_text" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "source" text DEFAULT 'signal' NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "title" text;--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "posts_owner_idx" ON "posts" USING btree ("owner");