ALTER TABLE "trend_workflow_items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "trend_workflow_items" ADD COLUMN "delete_reason" text;