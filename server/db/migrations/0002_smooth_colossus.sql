CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "posts_script_idx" ON "posts" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "scripts_signal_idx" ON "scripts" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signals_status_idx" ON "signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signals_published_idx" ON "signals" USING btree ("published_date");