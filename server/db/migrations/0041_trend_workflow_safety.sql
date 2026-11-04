ALTER TABLE "trend_teams_outbox" ADD COLUMN "sending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trend_teams_outbox" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "trend_teams_outbox" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "last_attempt_slot" text;--> statement-breakpoint
ALTER TABLE "trend_workflow_lease" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;