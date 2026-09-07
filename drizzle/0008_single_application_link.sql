ALTER TABLE "internships" ADD COLUMN "application_link" text;

UPDATE "internships"
SET "application_link" = NULLIF(BTRIM("application_links"[1]), '');

DELETE FROM "internships"
WHERE "application_link" IS NULL;

WITH duplicate_groups AS (
  SELECT
    MIN("id") AS survivor_id,
    BOOL_OR("applied") AS applied,
    BOOL_OR("disliked") AS disliked
  FROM "internships"
  GROUP BY "application_link"
  HAVING COUNT(*) > 1
)
UPDATE "internships" AS i
SET
  "applied" = duplicate_groups.applied,
  "disliked" = duplicate_groups.disliked
FROM duplicate_groups
WHERE i."id" = duplicate_groups.survivor_id;

DELETE FROM "internships" AS duplicate
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "application_link" ORDER BY "id") AS row_number
  FROM "internships"
) AS ranked
WHERE duplicate."id" = ranked."id"
  AND ranked.row_number > 1;

ALTER TABLE "internships" DROP COLUMN "application_links";
ALTER TABLE "internships" ALTER COLUMN "application_link" SET NOT NULL;
ALTER TABLE "internships"
  ADD CONSTRAINT "internships_application_link_unique" UNIQUE ("application_link");
