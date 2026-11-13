CREATE TABLE "chat_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"platform" text DEFAULT 'messenger_like' NOT NULL,
	"preset_version" text DEFAULT '1' NOT NULL,
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"export_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{"isMockup":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_projects_owner_idx" ON "chat_projects" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "chat_projects_shared_idx" ON "chat_projects" USING btree ("is_shared");--> statement-breakpoint
CREATE INDEX "chat_projects_updated_idx" ON "chat_projects" USING btree ("updated_at");