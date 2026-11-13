CREATE TABLE "group_insight_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_label" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"raw_json" jsonb NOT NULL,
	"summary_json" jsonb NOT NULL,
	"uploaded_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_insight_snapshots_source_sha256_unique" UNIQUE("source_sha256")
);
--> statement-breakpoint
CREATE TABLE "group_weekly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_label" text NOT NULL,
	"trend_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_snapshot_id" uuid,
	"context_json" jsonb,
	"draft_markdown" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_weekly_reports" ADD CONSTRAINT "group_weekly_reports_group_snapshot_id_group_insight_snapshots_id_fk" FOREIGN KEY ("group_snapshot_id") REFERENCES "public"."group_insight_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_insight_snapshots_expires_idx" ON "group_insight_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "group_insight_snapshots_created_idx" ON "group_insight_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "group_weekly_reports_week_idx" ON "group_weekly_reports" USING btree ("week_label");--> statement-breakpoint
CREATE INDEX "group_weekly_reports_expires_idx" ON "group_weekly_reports" USING btree ("expires_at");