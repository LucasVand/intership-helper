ALTER TABLE "internships"
  ADD COLUMN "source" text NOT NULL DEFAULT 'simplify';

ALTER TABLE "sync_runs"
  ADD COLUMN "source" text NOT NULL DEFAULT 'combined';
