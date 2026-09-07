ALTER TABLE "internships" ADD COLUMN "posted_at" timestamp;
UPDATE "internships"
SET "posted_at" = CURRENT_TIMESTAMP -
  CASE
    WHEN "age" ~ '^[0-9]+mo?$' THEN (regexp_replace("age", '[^0-9]', '', 'g')::integer * INTERVAL '30 days')
    WHEN "age" ~ '^[0-9]+d$' THEN (regexp_replace("age", '[^0-9]', '', 'g')::integer * INTERVAL '1 day')
    WHEN "age" ~ '^[0-9]+h$' THEN (regexp_replace("age", '[^0-9]', '', 'g')::integer * INTERVAL '1 hour')
    WHEN "age" ~ '^[0-9]+m$' THEN (regexp_replace("age", '[^0-9]', '', 'g')::integer * INTERVAL '1 minute')
    ELSE INTERVAL '0'
  END
WHERE "age" IS NOT NULL;
CREATE INDEX "posted_at_idx" ON "internships" USING btree ("posted_at");
ALTER TABLE "internships" DROP COLUMN "age";
