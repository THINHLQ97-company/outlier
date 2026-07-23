ALTER TABLE "signals" ADD COLUMN "cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "cluster_label" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "suggestion_json" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX "signals_cluster_idx" ON "signals" USING btree ("cluster_id");