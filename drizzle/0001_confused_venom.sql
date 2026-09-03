ALTER TABLE "internships" ADD COLUMN "applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "applied_idx" ON "internships" USING btree ("applied");