CREATE TABLE "files" (
	"key" text PRIMARY KEY NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"data_base64" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
