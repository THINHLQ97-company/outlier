CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'nguoi' NOT NULL,
	"prompt_description" text NOT NULL,
	"personality" text,
	"catchphrase" text,
	"reference_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"image_variants" jsonb DEFAULT '[]'::jsonb,
	"selected_image_url" text,
	"overlay_json" jsonb DEFAULT '{}'::jsonb,
	"final_image_url" text,
	"caption" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"checklist_json" jsonb DEFAULT '{}'::jsonb,
	"reject_reason" text,
	"fb_post_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weights_json" jsonb NOT NULL,
	"thresholds_json" jsonb NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"truc" text NOT NULL,
	"format_meme" text NOT NULL,
	"content_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_variant" integer,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"radar" text,
	"truc" text,
	"title" text NOT NULL,
	"raw_summary" text NOT NULL,
	"source_url" text,
	"published_date" timestamp with time zone DEFAULT now() NOT NULL,
	"score_json" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;