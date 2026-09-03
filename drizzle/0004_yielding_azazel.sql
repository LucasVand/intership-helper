CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"scraped_count" integer NOT NULL,
	"existing_count" integer NOT NULL,
	"inserted_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"total_after" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"scraped_url" text,
	"write_json" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sync_runs_created_at_idx" ON "sync_runs" USING btree ("created_at");