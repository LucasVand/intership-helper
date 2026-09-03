ALTER TABLE "internships" ADD COLUMN "no_sponsorship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "requires_citizenship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "is_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "is_faang" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "requires_advanced_degree" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "is_faang_idx" ON "internships" USING btree ("is_faang");--> statement-breakpoint
CREATE INDEX "is_closed_idx" ON "internships" USING btree ("is_closed");