import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { internships, syncRuns } from "../db/schema";
import { canadianTechSource } from "./sources/canadian-tech";
import { simplifySource } from "./sources/simplify";
import type { InternshipSourceAdapter, ScrapedInternship } from "./sources/types";
import { normalizeApplicationLink } from "./normalize-url";

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
  return normalizeApplicationLink(r.applicationLink);
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

function getLogFilePath(args: string[]): string | null {
  const flag = args.find((a) => a.startsWith("--log-file"));
  if (!flag) return process.env.SYNC_LOG_FILE ?? null;
  if (flag === "--log-file") return `logs/sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const eqIdx = flag.indexOf("=");
  if (eqIdx !== -1) return flag.slice(eqIdx + 1) || null;
  return process.env.SYNC_LOG_FILE ?? `logs/sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

function formatFlag(v: boolean | undefined): string {
  return v ? "true" : "false";
}

function flagLabel(key: string, before: boolean, after: boolean): string {
  const emoji: Record<string, string> = {
    noSponsorship: "🛂",
    requiresCitizenship: "🇺🇸",
    isClosed: "🔒",
    isFaang: "🔥",
    requiresAdvancedDegree: "🎓",
  };
  return `${key}${emoji[key] ? ` ${emoji[key]}` : ""}: ${formatFlag(before)}→${formatFlag(after)}`;
}

function buildLogPayload(
  newEntries: ScrapedInternship[],
  toUpdate: Array<{ id: number; flags: ScrapedInternship; cleanCompany: string; cleanRole: string; source: string; reasons: string[]; existing: any }>,
  meta: { scrapedCount: number; existingCount: number; totalAfter: number; durationMs: number; status: string; dryRun: boolean }
) {
  return {
    generatedAt: new Date().toISOString(),
    meta,
    inserted: newEntries.map((e, idx) => ({
      idx: idx + 1,
      source: e.source,
      company: e.company,
      role: e.role,
      location: e.location,
      applicationLink: e.applicationLink,
      postedAt: e.postedAt ? e.postedAt.toISOString() : null,
      flags: {
        noSponsorship: Boolean(e.noSponsorship),
        requiresCitizenship: Boolean(e.requiresCitizenship),
        isClosed: Boolean(e.isClosed),
        isFaang: Boolean(e.isFaang),
        requiresAdvancedDegree: Boolean(e.requiresAdvancedDegree),
      },
      reason: "new applicationLink not in DB",
    })),
    updated: toUpdate.map((u, idx) => ({
      idx: idx + 1,
      id: u.id,
      link: u.flags.applicationLink,
      before: {
        company: u.existing.company,
        role: u.existing.role,
        location: u.existing.location,
        source: u.existing.source,
        postedAt: u.existing.postedAt ? (u.existing.postedAt as Date).toISOString() : null,
        flags: {
          noSponsorship: u.existing.noSponsorship,
          requiresCitizenship: u.existing.requiresCitizenship,
          isClosed: u.existing.isClosed,
          isFaang: u.existing.isFaang,
          requiresAdvancedDegree: u.existing.requiresAdvancedDegree,
        },
      },
      after: {
        company: u.cleanCompany,
        role: u.cleanRole,
        location: u.flags.location,
        source: u.source,
        postedAt: u.flags.postedAt ? u.flags.postedAt.toISOString() : null,
        flags: {
          noSponsorship: Boolean(u.flags.noSponsorship),
          requiresCitizenship: Boolean(u.flags.requiresCitizenship),
          isClosed: Boolean(u.flags.isClosed),
          isFaang: Boolean(u.flags.isFaang),
          requiresAdvancedDegree: Boolean(u.flags.requiresAdvancedDegree),
        },
      },
      reasons: u.reasons,
    })),
  };
}

function maybeWriteLogFile(logFilePath: string | null, payload: unknown) {
  if (!logFilePath) return;
  try {
    const dir = path.dirname(logFilePath);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logFilePath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nDetailed log written to ${logFilePath} (${(JSON.stringify(payload).length / 1024).toFixed(1)} KB)`);
  } catch (e: any) {
    console.warn(`  warning: could not write log file ${logFilePath}: ${e?.message ?? e}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const logFilePath = getLogFilePath(args);
  const startMs = Date.now();

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: tsx scripts/sync-internships.ts [options]

Options:
  --dry-run              Fetch and report new entries without inserting
  --log-file[=PATH]      Also write detailed JSON to file (default: logs/sync-<timestamp>.json when flag given without path)
  --help, -h             Show this help

Env:
  DATABASE_URL   Postgres connection (preferred)
  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
                  Used to build the same connection URL as Docker Compose
  POSTGRES_HOST  Database hostname (default: db)
  POSTGRES_PORT  Database port (default: 5432)
  SYNC_LOG_FILE  Alternative way to set --log-file path

Examples:
  npx tsx scripts/sync-internships.ts --dry-run
  npx tsx scripts/sync-internships.ts --log-file
  npx tsx scripts/sync-internships.ts --log-file=./logs/latest.json
  SYNC_LOG_FILE=./logs/sync.json npm run db:sync
  npm run db:sync:dry

Logs:
  stdout: always. In Docker: docker compose logs sync  or  docker logs intership-helper-sync
  file: only when --log-file / SYNC_LOG_FILE is set. Mount ./logs:/app/logs in compose to persist.
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
    scraped = batches.flat().map((row) => ({
      ...row,
      applicationLink: normalizeApplicationLink(row.applicationLink),
    }));
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
  const duplicateRows: Array<{ duplicate: typeof existing[number]; survivor: typeof existing[number] }> = [];
  for (const r of existing) {
    const key = makeKey(r);
    const survivor = existingMap.get(key);
    if (survivor) duplicateRows.push({ duplicate: r, survivor });
    else existingMap.set(key, r);
  }

  if (duplicateRows.length > 0) {
    console.log(`Found ${duplicateRows.length} existing duplicate URL variant${duplicateRows.length === 1 ? "" : "s"} to consolidate`);
    for (const { duplicate, survivor } of duplicateRows) {
      survivor.applied ||= duplicate.applied;
      survivor.disliked ||= duplicate.disliked;
      survivor.noSponsorship ||= duplicate.noSponsorship;
      survivor.requiresCitizenship ||= duplicate.requiresCitizenship;
      survivor.isClosed ||= duplicate.isClosed;
      survivor.isFaang ||= duplicate.isFaang;
      survivor.requiresAdvancedDegree ||= duplicate.requiresAdvancedDegree;
      if (survivor.source !== duplicate.source) survivor.source = "multiple";
    }

    if (!dryRun) {
      await db.delete(internships).where(inArray(internships.id, duplicateRows.map(({ duplicate }) => duplicate.id)));
      for (const { survivor } of duplicateRows) {
        await db
          .update(internships)
          .set({
            applicationLink: makeKey(survivor),
            applied: survivor.applied,
            disliked: survivor.disliked,
            noSponsorship: survivor.noSponsorship,
            requiresCitizenship: survivor.requiresCitizenship,
            isClosed: survivor.isClosed,
            isFaang: survivor.isFaang,
            requiresAdvancedDegree: survivor.requiresAdvancedDegree,
            source: survivor.source,
          })
          .where(eq(internships.id, survivor.id));
      }
    }
  }
  const existingAfterDedup = existing.length - duplicateRows.length;

  const seenScrapedLinks = new Set<string>();
  const newEntries = scraped.filter((r) => {
    const link = makeKey(r);
    if (!link || existingMap.has(link) || seenScrapedLinks.has(link)) return false;
    seenScrapedLinks.add(link);
    return true;
  });

  // Also detect existing rows where legend flags or cleaned text have changed (backfill)
  type ToUpdateEntry = {
    id: number;
    flags: ScrapedInternship;
    cleanCompany: string;
    cleanRole: string;
    source: string;
    reasons: string[];
    existing: typeof existing[number];
  };
  const toUpdate: ToUpdateEntry[] = [];
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
    const reasons: string[] = [];

    if (ex.applicationLink !== key) reasons.push(`applicationLink: "${ex.applicationLink}" → "${key}"`);
    if (ex.noSponsorship !== sFlags.noSponsorship) reasons.push(flagLabel("noSponsorship", ex.noSponsorship, sFlags.noSponsorship));
    if (ex.requiresCitizenship !== sFlags.requiresCitizenship) reasons.push(flagLabel("requiresCitizenship", ex.requiresCitizenship, sFlags.requiresCitizenship));
    if (ex.isClosed !== sFlags.isClosed) reasons.push(flagLabel("isClosed", ex.isClosed, sFlags.isClosed));
    if (ex.isFaang !== sFlags.isFaang) reasons.push(flagLabel("isFaang", ex.isFaang, sFlags.isFaang));
    if (ex.requiresAdvancedDegree !== sFlags.requiresAdvancedDegree) reasons.push(flagLabel("requiresAdvancedDegree", ex.requiresAdvancedDegree, sFlags.requiresAdvancedDegree));

    if (ex.company !== s.company) reasons.push(`company: "${ex.company}" → "${s.company}"`);
    if (ex.role !== s.role) reasons.push(`role: "${ex.role}" → "${s.role}"`);

    const mergedSource = ex.source === s.source || ex.source === "multiple" ? ex.source : "multiple";
    if (ex.source !== mergedSource) reasons.push(`source: ${ex.source} → ${mergedSource}`);

    if (s.postedAt) {
      if (!ex.postedAt) reasons.push(`postedAt: null → ${s.postedAt.toISOString()} (now dated)`);
      else {
        const diffMs = Math.abs(ex.postedAt.getTime() - s.postedAt.getTime());
        if (diffMs > 12 * 60 * 60 * 1000) {
          const diffH = (diffMs / (60 * 60 * 1000)).toFixed(1);
          reasons.push(`postedAt: ${ex.postedAt.toISOString()} → ${s.postedAt.toISOString()} (Δ${diffH}h)`);
        }
      }
    }

    if (reasons.length > 0) {
      toUpdate.push({ id: ex.id, flags: s, cleanCompany: s.company, cleanRole: s.role, source: mergedSource, reasons, existing: ex });
    }
  }

  console.log(`New entries to insert: ${newEntries.length} (out of ${scraped.length} scraped)`);
  console.log(`Existing rows needing update: ${toUpdate.length}`);

  // Always log every insert with why/what — stdout is the primary channel (docker logs / compose logs)
  if (newEntries.length > 0) {
    console.log(`\n=== INSERTS (${newEntries.length}) — new applicationLink not in DB ===`);
    for (let i = 0; i < newEntries.length; i++) {
      const e = newEntries[i];
      const flagStr = `noSponsorship=${formatFlag(e.noSponsorship)} requiresCitizenship=${formatFlag(e.requiresCitizenship)} isClosed=${formatFlag(e.isClosed)} isFaang=${formatFlag(e.isFaang)} requiresAdvancedDegree=${formatFlag(e.requiresAdvancedDegree)}`;
      const postedAtStr = e.postedAt ? e.postedAt.toISOString() : "null";
      console.log(`  + [${i + 1}/${newEntries.length}] [${e.source}] "${e.company}" — "${e.role}" — ${e.location} | link=${e.applicationLink} | ${flagStr} | postedAt=${postedAtStr} | reason: new link`);
    }
  } else {
    console.log(`No new inserts — all scraped links already in DB`);
  }

  if (toUpdate.length > 0) {
    console.log(`\n=== UPDATES (${toUpdate.length}) — existing link with changed fields ===`);
    for (let i = 0; i < toUpdate.length; i++) {
      const u = toUpdate[i];
      const flagStr = `noSponsorship=${formatFlag(u.flags.noSponsorship)} requiresCitizenship=${formatFlag(u.flags.requiresCitizenship)} isClosed=${formatFlag(u.flags.isClosed)} isFaang=${formatFlag(u.flags.isFaang)} requiresAdvancedDegree=${formatFlag(u.flags.requiresAdvancedDegree)}`;
      const postedAtStr = u.flags.postedAt ? u.flags.postedAt.toISOString() : "null";
      const locationNote = u.existing.location !== u.flags.location ? ` | location drift: "${u.existing.location}" → "${u.flags.location}" (not triggering update)` : "";
      console.log(`  ~ [${i + 1}/${toUpdate.length}] id=${u.id} [${u.existing.source}→${u.source}] "${u.existing.company}" → "${u.cleanCompany}" | "${u.existing.role}" → "${u.cleanRole}" | link=${u.flags.applicationLink}${locationNote}`);
      console.log(`      reasons: ${u.reasons.join("; ")} | flags→ ${flagStr} | postedAt→ ${postedAtStr}`);
    }
  } else {
    console.log(`No updates — existing rows match scraped flags/text/postedAt/source`);
  }

  if (newEntries.length === 0 && toUpdate.length === 0 && duplicateRows.length === 0) {
    console.log("DB is already up to date — nothing to do");
    const durationMs = Date.now() - startMs;
    if (logFilePath) {
      const payload = buildLogPayload(newEntries, toUpdate, {
        scrapedCount: scraped.length,
        existingCount: existing.length,
        totalAfter: existingAfterDedup,
        durationMs,
        status: "success",
        dryRun: false,
      });
      maybeWriteLogFile(logFilePath, payload);
    }
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: 0,
      updatedCount: 0,
      totalAfter: existingAfterDedup,
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
    if (logFilePath) {
      const payload = buildLogPayload(newEntries, toUpdate, {
        scrapedCount: scraped.length,
        existingCount: existing.length,
        totalAfter: existingAfterDedup,
        durationMs,
        status: "dry_run",
        dryRun: true,
      });
      maybeWriteLogFile(logFilePath, payload);
    } else if (newEntries.length + toUpdate.length > 0) {
      console.log(`\nTip: re-run with --log-file to also save these ${newEntries.length + toUpdate.length} rows to JSON (e.g. --log-file=logs/sync.json or SYNC_LOG_FILE=logs/sync.json)`);
    }
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: newEntries.length,
      updatedCount: toUpdate.length,
      totalAfter: existingAfterDedup,
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
        applicationLink: makeKey(u.flags),
      })
      .where(eq(internships.id, u.id));
    updated++;
    if (updated % 100 === 0 || updated === toUpdate.length) console.log(`  updated ${updated}/${toUpdate.length}`);
  }

  const durationMs = Date.now() - startMs;
  console.log(`Done — inserted ${inserted} new, updated ${updated} existing. DB now has ${existingAfterDedup + inserted} rows`);
  if (logFilePath) {
    const payload = buildLogPayload(newEntries, toUpdate, {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      totalAfter: existingAfterDedup + inserted,
      durationMs,
      status: "success",
      dryRun: false,
    });
    maybeWriteLogFile(logFilePath, payload);
  } else if (inserted + updated > 0) {
    console.log(`Tip: re-run with --log-file to save per-row diffs to JSON (e.g. --log-file=logs/sync.json)`);
  }

  await recordSyncRun(pool, db, {
    scrapedCount: scraped.length,
    existingCount: existing.length,
    insertedCount: inserted,
    updatedCount: updated,
    totalAfter: existingAfterDedup + inserted,
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
