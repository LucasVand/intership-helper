CREATE TABLE "top_pick_keywords" (
	"id" serial PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "top_pick_keywords_keyword_unique" UNIQUE("keyword")
);
--> statement-breakpoint
CREATE INDEX "keyword_idx" ON "top_pick_keywords" USING btree ("keyword");