CREATE TABLE "internships" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"location" text NOT NULL,
	"application_links" text[] NOT NULL,
	"age" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "company_idx" ON "internships" USING btree ("company");--> statement-breakpoint
CREATE INDEX "age_idx" ON "internships" USING btree ("age");