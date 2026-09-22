ALTER TABLE "deconstructions" ADD COLUMN "needs_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deconstructions" ADD COLUMN "estimated_cost_usd" text;