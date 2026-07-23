CREATE TABLE "rag_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"post_id" uuid,
	"scene" text,
	"prompt_json" text,
	"params_json" jsonb DEFAULT '{}'::jsonb,
	"image_url" text,
	"embedding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_profiles" (
	"owner" text PRIMARY KEY NOT NULL,
	"profile_text" text,
	"example_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rag_examples_owner_idx" ON "rag_examples" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "rag_examples_post_idx" ON "rag_examples" USING btree ("post_id");