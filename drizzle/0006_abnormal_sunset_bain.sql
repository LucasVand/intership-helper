ALTER TABLE "internships" ADD COLUMN "disliked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "disliked_idx" ON "internships" USING btree ("disliked");