import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { internships, syncRuns } from "../db/schema";
import { canadianTechSource } from "./sources/canadian-tech";
import { simplifySource } from "./sources/simplify";
import type { InternshipSourceAdapter, ScrapedInternship } from "./sources/types";

const SOURCES: InternshipSourceAdapter[] = [simplifySource, canadianTechSource];

function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;

  const host = process.env.POSTGRES_HOST ?? "db";
  const port = process.env.POSTGRES_PORT ?? "5432";
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(POSTGRES_DB)}`;
}

function makeKey(r: ScrapedInternship | { applicationLink: string }): string {
  return r.applicationLink.trim();
}

async function recordSyncRun(
  pool: Pool,
  db: ReturnType<typeof drizzle>,
  data: {
    scrapedCount: number;
    existingCount: number;
    insertedCount: number;
    updatedCount: number;
    totalAfter: number;
    durationMs: number;
    status: string;
    error?: string | null;
    scrapedUrl: string;
  }
) {
  try {
    await db.insert(syncRuns).values({
      scrapedCount: data.scrapedCount,
      existingCount: data.existingCount,
      insertedCount: data.insertedCount,
      updatedCount: data.updatedCount,
      totalAfter: data.totalAfter,
      durationMs: data.durationMs,
      status: data.status,
      error: data.error ?? null,
      scrapedUrl: data.scrapedUrl,
      source: "combined",
    });
    console.log(`  sync history recorded: ${data.status} +${data.insertedCount} ~${data.updatedCount} in ${data.durationMs}ms`);
  } catch (e) {
    // table may not exist yet if migration not run — warn but don't fail sync
    console.warn("  warning: could not record sync run (maybe run `npm run db:migrate`):", String(e).slice(0, 200));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const startMs = Date.now();

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: tsx scripts/sync-internships.ts [options]

Options:
  --dry-run      Fetch and report new entries without inserting
  --verbose      Extra logging
  --help         Show this help

Env:
  DATABASE_URL   Postgres connection (preferred)
  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
                 Used to build the same connection URL as Docker Compose
  POSTGRES_HOST  Database hostname (default: db)
  POSTGRES_PORT  Database port (default: 5432)

Examples:
  npx tsx scripts/sync-internships.ts --dry-run
  npm run db:sync
  npm run db:sync:dry
`);
    process.exit(0);
  }

  console.log("Fetching internships from configured sources...");
  SOURCES.forEach((source) => console.log(`  ${source.source}: ${source.url}`));
  let scraped: ScrapedInternship[] = [];
  try {
    const batches = await Promise.all(SOURCES.map(async (source) => {
      const rows = await source.fetchAndParse();
      console.log(`  ${source.source}: found ${rows.length} rows`);
      return rows;
    }));
    scraped = batches.flat();
  } catch (e: any) {
    console.error("Failed to fetch/parse internship source:", e?.message ?? e);
    // if DB available, record failure
    const connectionString = getDatabaseUrl();
    if (connectionString) {
      try {
        const pool = new Pool({ connectionString });
        const db = drizzle(pool);
        await recordSyncRun(pool, db, {
          scrapedCount: 0,
          existingCount: 0,
          insertedCount: 0,
          updatedCount: 0,
          totalAfter: 0,
          durationMs: Date.now() - startMs,
          status: "failed",
          error: String(e?.message ?? e).slice(0, 2000),
          scrapedUrl: SOURCES.map((source) => source.url).join(","),
        });
        await pool.end();
      } catch {}
    }
    process.exit(1);
  }
  console.log(`Found ${scraped.length} rows across all sources`);

  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    console.error("Database configuration missing — set DATABASE_URL or POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB.");
    process.exit(1);
  }

  console.log(`Connecting to DB...`);
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  let existing: typeof internships.$inferSelect[];
  try {
    const rows = await db.select().from(internships);
    existing = rows;
    console.log(`DB has ${existing.length} existing internships`);
  } catch (e: any) {
    console.error("Failed to query DB (have you run `npm run db:migrate`?):", e);
    const durationMs = Date.now() - startMs;
    try {
      await recordSyncRun(pool, db as any, {
        scrapedCount: scraped.length,
        existingCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        totalAfter: 0,
        durationMs,
        status: "failed",
        error: String(e?.message ?? e).slice(0, 2000),
        scrapedUrl: SOURCES.map((source) => source.url).join(","),
      });
    } catch {}
    await pool.end();
    process.exit(1);
  }

  const existingMap = new Map<string, typeof existing[number]>();
  for (const r of existing) {
    existingMap.set(r.applicationLink, r);
  }
  if (verbose) console.log(`  built ${existingMap.size} existing keys`);

  const seenScrapedLinks = new Set<string>();
  const newEntries = scraped.filter((r) => {
    const link = makeKey(r);
    if (!link || existingMap.has(link) || seenScrapedLinks.has(link)) return false;
    seenScrapedLinks.add(link);
    return true;
  });

  // Also detect existing rows where legend flags or cleaned text have changed (backfill)
  const toUpdate: Array<{ id: number; flags: ScrapedInternship; cleanCompany: string; cleanRole: string; source: string }> = [];
  for (const s of scraped) {
    const key = makeKey(s);
    if (!key) continue;
    const ex = existingMap.get(key);
    if (!ex) continue;
    const sFlags = {
      noSponsorship: Boolean(s.noSponsorship),
      requiresCitizenship: Boolean(s.requiresCitizenship),
      isClosed: Boolean(s.isClosed),
      isFaang: Boolean(s.isFaang),
      requiresAdvancedDegree: Boolean(s.requiresAdvancedDegree),
    };
    const needsFlagUpdate =
      ex.noSponsorship !== sFlags.noSponsorship ||
      ex.requiresCitizenship !== sFlags.requiresCitizenship ||
      ex.isClosed !== sFlags.isClosed ||
      ex.isFaang !== sFlags.isFaang ||
      ex.requiresAdvancedDegree !== sFlags.requiresAdvancedDegree;
    const needsTextUpdate = ex.company !== s.company || ex.role !== s.role;
    const mergedSource = ex.source === s.source || ex.source === "multiple" ? ex.source : "multiple";
    const needsSourceUpdate = ex.source !== mergedSource;
    const needsPostedAtUpdate =
      Boolean(s.postedAt) &&
      (!ex.postedAt || Math.abs(ex.postedAt.getTime() - s.postedAt!.getTime()) > 12 * 60 * 60 * 1000);
    if (needsFlagUpdate || needsTextUpdate || needsPostedAtUpdate || needsSourceUpdate) {
      toUpdate.push({ id: ex.id, flags: s, cleanCompany: s.company, cleanRole: s.role, source: mergedSource });
    }
  }

  console.log(`New entries to insert: ${newEntries.length} (out of ${scraped.length} scraped)`);
  console.log(`Existing rows needing flag update: ${toUpdate.length}`);
  if (verbose && newEntries.length) {
    newEntries.slice(0, 10).forEach((e) => console.log(`  + [${e.source}] ${e.company} — ${e.role} — ${e.location}`));
    if (newEntries.length > 10) console.log(`  ... and ${newEntries.length - 10} more`);
  }
  if (verbose && toUpdate.length) {
    toUpdate.slice(0, 10).forEach((u) => console.log(`  ~ update id=${u.id} ${u.flags.company} — ${u.flags.role}`));
    if (toUpdate.length > 10) console.log(`  ... and ${toUpdate.length - 10} more updates`);
  }

  if (newEntries.length === 0 && toUpdate.length === 0) {
    console.log("DB is already up to date — nothing to do");
    const durationMs = Date.now() - startMs;
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: 0,
      updatedCount: 0,
      totalAfter: existing.length,
      durationMs,
      status: "success",
      error: null,
      scrapedUrl: SOURCES.map((source) => source.url).join(","),
    });
    await pool.end();
    process.exit(0);
  }

  if (dryRun) {
    console.log("Dry run — not inserting/updating. Remove --dry-run to apply.");
    const durationMs = Date.now() - startMs;
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: newEntries.length,
      updatedCount: toUpdate.length,
      totalAfter: existing.length,
      durationMs,
      status: "dry_run",
      error: null,
      scrapedUrl: SOURCES.map((source) => source.url).join(","),
    });
    await pool.end();
    process.exit(0);
  }

  // Batch insert with legend flags
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < newEntries.length; i += batchSize) {
    const batch = newEntries.slice(i, i + batchSize).map((row) => ({
      company: row.company,
      role: row.role,
      location: row.location,
      applicationLink: row.applicationLink,
      source: row.source,
      postedAt: row.postedAt ?? null,
      applied: false,
      noSponsorship: Boolean(row.noSponsorship),
      requiresCitizenship: Boolean(row.requiresCitizenship),
      isClosed: Boolean(row.isClosed),
      isFaang: Boolean(row.isFaang),
      requiresAdvancedDegree: Boolean(row.requiresAdvancedDegree),
    }));
    await db.insert(internships).values(batch);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${newEntries.length}`);
  }

  // Update existing rows where flags or cleaned text changed
  let updated = 0;
  for (const u of toUpdate) {
    await db
      .update(internships)
      .set({
        company: u.cleanCompany,
        role: u.cleanRole,
        noSponsorship: Boolean(u.flags.noSponsorship),
        requiresCitizenship: Boolean(u.flags.requiresCitizenship),
        isClosed: Boolean(u.flags.isClosed),
        isFaang: Boolean(u.flags.isFaang),
        requiresAdvancedDegree: Boolean(u.flags.requiresAdvancedDegree),
        source: u.source,
        postedAt: u.flags.postedAt ?? null,
      })
      .where(eq(internships.id, u.id));
    updated++;
    if (verbose || updated % 100 === 0) console.log(`  updated ${updated}/${toUpdate.length}`);
  }

  const durationMs = Date.now() - startMs;
  console.log(`Done — inserted ${inserted} new, updated ${updated} existing. DB now has ${existing.length + inserted} rows`);

  await recordSyncRun(pool, db, {
    scrapedCount: scraped.length,
    existingCount: existing.length,
    insertedCount: inserted,
    updatedCount: updated,
    totalAfter: existing.length + inserted,
    durationMs,
    status: "success",
    error: null,
    scrapedUrl: SOURCES.map((source) => source.url).join(","),
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  // try to record failure if possible
  try {
    const connectionString = getDatabaseUrl();
    if (connectionString) {
      const pool = new Pool({ connectionString });
      const db = drizzle(pool);
      await recordSyncRun(pool, db, {
        scrapedCount: 0,
        existingCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        totalAfter: 0,
        durationMs: 0,
        status: "failed",
        error: String(err?.message ?? err).slice(0, 2000),
        scrapedUrl: SOURCES.map((source) => source.url).join(","),
      });
      await pool.end();
    }
  } catch {}
  process.exit(1);
});
