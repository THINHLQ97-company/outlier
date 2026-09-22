ALTER TABLE "remakes" ADD COLUMN "images_json" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "remakes" ADD COLUMN "selected_image_url" text;