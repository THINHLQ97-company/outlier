CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"remake_id" uuid,
	"title" text,
	"aspect_ratio" text DEFAULT '9:16' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"script_text" text,
	"final_video_key" text,
	"generated_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"narration" text,
	"visual_prompt" text,
	"duration_sec" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"clip_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "video_projects_owner_idx" ON "video_projects" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "video_scenes_proj_idx" ON "video_scenes" USING btree ("project_id","order_index");