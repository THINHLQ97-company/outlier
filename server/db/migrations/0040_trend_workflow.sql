CREATE TABLE "trend_teams_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"item_id" uuid,
	"destination" text DEFAULT 'outlier_teams' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_teams_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "trend_workflow_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"fanpage_id" uuid NOT NULL,
	"remake_id" uuid NOT NULL,
	"page_name" text NOT NULL,
	"angle" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trend_workflow_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"input_key" text NOT NULL,
	"title" text NOT NULL,
	"input" jsonb NOT NULL,
	"event_key" text,
	"duplicate_of" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"checkpoint" text DEFAULT 'pending' NOT NULL,
	"brief" jsonb,
	"deconstruction_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_workflow_lease" (
	"key" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"owner" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"max_model_calls" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_workflow_runs_slot_unique" UNIQUE("slot")
);
--> statement-breakpoint
ALTER TABLE "trend_teams_outbox" ADD CONSTRAINT "trend_teams_outbox_item_id_trend_workflow_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."trend_workflow_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_workflow_drafts" ADD CONSTRAINT "trend_workflow_drafts_item_id_trend_workflow_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."trend_workflow_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD CONSTRAINT "trend_workflow_items_run_id_trend_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trend_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trend_workflow_draft_unique" ON "trend_workflow_drafts" USING btree ("item_id","fanpage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trend_workflow_input_unique" ON "trend_workflow_items" USING btree ("run_id","input_key");