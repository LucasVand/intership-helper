import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { internships, syncRuns } from "../db/schema";
import { canadianTechSource } from "./sources/canadian-tech";
import { simplifySource } from "./sources/simplify";
import type { ScrapedInternship } from "./sources/types";
import { normalizeApplicationLink } from "./normalize-url";

const SOURCES = [simplifySource, canadianTechSource] as const;

export function isTruncatedL3HarrisLink(link: string): boolean {
  // Detects truncated L3Harris URLs from old parser: https://jobs.l3harris.com/job/Waterdown-Software-Engineering-Co-Op-(Waterdown,-CAN
  // without the trailing )-ON-L9H-0C5/{jobId}/?ats=... — caused by regex /\]\(([^)]+)\)/ stopping at first ')' inside URL
  return link.includes("(Waterdown,-CAN") && !link.includes("1430") && !link.includes("?ats=");
}

export function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;
  const host = process.env.POSTGRES_HOST ?? "db";
  const port = process.env.POSTGRES_PORT ?? "5432";
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(POSTGRES_DB)}`;
}

export function makeKey(r: ScrapedInternship | { applicationLink: string }): string {
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
    details?: unknown;
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
      details: (data as any).details ?? null,
    } as any);
    console.log(`  sync history recorded: ${data.status} +${data.insertedCount} ~${data.updatedCount} in ${data.durationMs}ms`);
  } catch {
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
      console.log(`  sync history recorded (fallback without details): ${data.status} +${data.insertedCount} ~${data.updatedCount} in ${data.durationMs}ms`);
    } catch (e) {
      console.warn("  warning: could not record sync run (maybe run `npm run db:migrate`):", String(e).slice(0, 200));
    }
  }
}

export function getLogFilePath(args: string[]): string | null {
  const flag = args.find((a) => a.startsWith("--log-file"));
  if (!flag) return process.env.SYNC_LOG_FILE ?? null;
  if (flag === "--log-file") return `logs/sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const eqIdx = flag.indexOf("=");
  if (eqIdx !== -1) return flag.slice(eqIdx + 1) || null;
  return process.env.SYNC_LOG_FILE ?? `logs/sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

export function formatFlag(v: boolean | undefined): string {
  return v ? "true" : "false";
}

export function flagLabel(key: string, before: boolean, after: boolean): string {
  const emoji: Record<string, string> = {
    noSponsorship: "🛂",
    requiresCitizenship: "🇺🇸",
    isClosed: "🔒",
    isFaang: "🔥",
    requiresAdvancedDegree: "🎓",
  };
  return `${key}${emoji[key] ? ` ${emoji[key]}` : ""}: ${formatFlag(before)}→${formatFlag(after)}`;
}

export function buildLogPayload(
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

export function maybeWriteLogFile(logFilePath: string | null, payload: unknown) {
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

export function findDuplicateRows(existing: Array<{ applicationLink: string } & Record<string, any>>) {
  const existingMap = new Map<string, (typeof existing)[number]>();
  const duplicateRows: Array<{ duplicate: (typeof existing)[number]; survivor: (typeof existing)[number] }> = [];
  for (const r of existing) {
    const key = makeKey(r as any);
    const survivor = existingMap.get(key);
    if (survivor) duplicateRows.push({ duplicate: r as any, survivor });
    else existingMap.set(key, r as any);
  }
  return { existingMap, duplicateRows };
}

export function computeNewEntries(
  scraped: ScrapedInternship[],
  existingMap: Map<string, any>,
): ScrapedInternship[] {
  const seenScrapedLinks = new Set<string>();
  return scraped.filter((r) => {
    const link = makeKey(r);
    if (!link || existingMap.has(link) || seenScrapedLinks.has(link)) return false;
    seenScrapedLinks.add(link);
    return true;
  });
}

export type ToUpdateEntry = {
  id: number;
  flags: ScrapedInternship;
  cleanCompany: string;
  cleanRole: string;
  source: string;
  reasons: string[];
  existing: any;
};

export function computeToUpdate(
  scraped: ScrapedInternship[],
  existingMap: Map<string, any>,
): ToUpdateEntry[] {
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
  return toUpdate;
}

export function buildDetails(
  perSourceScraped: Record<string, number>,
  newEntries: ScrapedInternship[],
  toUpdate: ToUpdateEntry[],
): {
  perSource: Record<string, { scraped: number; inserted: number; updated: number }>;
  reasonCounts: Record<string, number>;
  insertedSample: Array<{ company: string; role: string; location: string; source: string; applicationLink: string }>;
  updatedSample: Array<{ id: number; company: string; role: string; source: string; reasons: string[] }>;
} {
  const insertedBySource: Record<string, number> = {};
  const updatedBySource: Record<string, number> = {};
  for (const e of newEntries) {
    insertedBySource[e.source] = (insertedBySource[e.source] ?? 0) + 1;
  }
  for (const u of toUpdate) {
    const src = (u.flags.source as string) ?? "unknown";
    updatedBySource[src] = (updatedBySource[src] ?? 0) + 1;
  }
  const allSources = new Set<string>([...Object.keys(perSourceScraped), ...Object.keys(insertedBySource), ...Object.keys(updatedBySource)]);
  const perSource: Record<string, { scraped: number; inserted: number; updated: number }> = {};
  for (const src of allSources) {
    perSource[src] = {
      scraped: perSourceScraped[src] ?? 0,
      inserted: insertedBySource[src] ?? 0,
      updated: updatedBySource[src] ?? 0,
    };
  }
  const reasonCounts: Record<string, number> = {};
  for (const u of toUpdate) {
    for (const r of u.reasons) {
      const key = r.split(":")[0].trim().split(" ")[0] || r.slice(0, 30);
      reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
    }
  }
  const insertedSample = newEntries.slice(0, 5).map((e) => ({
    company: e.company,
    role: e.role,
    location: e.location,
    source: e.source,
    applicationLink: e.applicationLink,
  }));
  const updatedSample = toUpdate.slice(0, 5).map((u) => ({
    id: u.id,
    company: u.cleanCompany,
    role: u.cleanRole,
    source: u.source,
    reasons: u.reasons,
  }));
  return { perSource, reasonCounts, insertedSample, updatedSample };
}

export type RunSyncOptions = {
  dbUrl: string;
  dryRun?: boolean;
  logFilePath?: string | null;
};

export type RunSyncResult = {
  scrapedCount: number;
  existingCount: number;
  insertedCount: number;
  updatedCount: number;
  totalAfter: number;
  durationMs: number;
  status: string;
  perSource: Record<string, { scraped: number; inserted: number; updated: number }>;
  reasonCounts: Record<string, number>;
  details: ReturnType<typeof buildDetails>;
};

export async function runSync(options: RunSyncOptions): Promise<RunSyncResult> {
  const { dbUrl, dryRun = false, logFilePath = null } = options;
  const startMs = Date.now();

  console.log("Fetching internships from configured sources...");
  SOURCES.forEach((source) => console.log(`  ${source.source}: ${source.url}`));

  let scraped: ScrapedInternship[] = [];
  let perSourceScraped: Record<string, number> = {};
  try {
    const batches = await Promise.all(
      SOURCES.map(async (source) => {
        const rows = await source.fetchAndParse();
        console.log(`  ${source.source}: found ${rows.length} rows`);
        return rows;
      })
    );
    SOURCES.forEach((source, idx) => {
      perSourceScraped[source.source] = batches[idx].length;
    });
    scraped = batches.flat().map((row) => ({
      ...row,
      applicationLink: normalizeApplicationLink(row.applicationLink),
    }));
  } catch (e: any) {
    console.error("Failed to fetch/parse internship source:", e?.message ?? e);
    const pool = new Pool({ connectionString: dbUrl });
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
      scrapedUrl: SOURCES.map((s) => s.url).join(","),
      details: { perSource: perSourceScraped, error: String(e?.message ?? e).slice(0, 500) },
    });
    await pool.end();
    throw e;
  }

  console.log(`Found ${scraped.length} rows across all sources`);
  console.log(`Connecting to DB...`);
  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  let existing: typeof internships.$inferSelect[];
  let originalExistingCount = 0;
  try {
    const rows = await db.select().from(internships);
    existing = rows;
    console.log(`DB has ${existing.length} existing internships`);
    originalExistingCount = existing.length;
  } catch (e: any) {
    console.error("Failed to query DB (have you run `npm run db:migrate`?):", e);
    const durationMs = Date.now() - startMs;
    try {
      const detailsOnFailure = buildDetails(perSourceScraped, [], []);
      await recordSyncRun(pool, db as any, {
        scrapedCount: scraped.length,
        existingCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        totalAfter: 0,
        durationMs,
        status: "failed",
        error: String(e?.message ?? e).slice(0, 2000),
        scrapedUrl: SOURCES.map((s) => s.url).join(","),
        details: detailsOnFailure,
      });
    } catch {}
    await pool.end();
    throw e;
  }

  // One-time cleanup for truncated L3Harris URLs from old parser (regex stopped at first ')' inside URL)
  const truncatedRows = existing.filter((r) => isTruncatedL3HarrisLink(r.applicationLink));
  if (truncatedRows.length > 0) {
    console.log(`Found ${truncatedRows.length} truncated L3Harris URLs to clean up (old parser bug)`);
    if (!dryRun) {
      await db.delete(internships).where(inArray(internships.id, truncatedRows.map((r) => r.id)));
      existing = existing.filter((r) => !isTruncatedL3HarrisLink(r.applicationLink));
      console.log(`  deleted ${truncatedRows.length} truncated rows — they will be re-inserted with correct full URLs on next sync`);
    } else {
      console.log(`  dry run — would delete ${truncatedRows.length} truncated rows`);
      // for dryRun, pretend they are already deleted for stats
      existing = existing.filter((r) => !isTruncatedL3HarrisLink(r.applicationLink));
    }
  }

  const { existingMap, duplicateRows } = findDuplicateRows(existing as any);

  if (duplicateRows.length > 0) {
    console.log(`Found ${duplicateRows.length} existing duplicate URL variant${duplicateRows.length === 1 ? "" : "s"} to consolidate`);
    for (const { duplicate, survivor } of duplicateRows) {
      (survivor as any).applied ||= (duplicate as any).applied;
      (survivor as any).disliked ||= (duplicate as any).disliked;
      (survivor as any).noSponsorship ||= (duplicate as any).noSponsorship;
      (survivor as any).requiresCitizenship ||= (duplicate as any).requiresCitizenship;
      (survivor as any).isClosed ||= (duplicate as any).isClosed;
      (survivor as any).isFaang ||= (duplicate as any).isFaang;
      (survivor as any).requiresAdvancedDegree ||= (duplicate as any).requiresAdvancedDegree;
      if ((survivor as any).source !== (duplicate as any).source) (survivor as any).source = "multiple";
    }
    if (!dryRun) {
      await db.delete(internships).where(inArray(internships.id, duplicateRows.map(({ duplicate }) => duplicate.id)));
      for (const { survivor } of duplicateRows) {
        await db
          .update(internships)
          .set({
            applicationLink: makeKey(survivor as any),
            applied: (survivor as any).applied,
            disliked: (survivor as any).disliked,
            noSponsorship: (survivor as any).noSponsorship,
            requiresCitizenship: (survivor as any).requiresCitizenship,
            isClosed: (survivor as any).isClosed,
            isFaang: (survivor as any).isFaang,
            requiresAdvancedDegree: (survivor as any).requiresAdvancedDegree,
            source: (survivor as any).source,
          })
          .where(eq(internships.id, survivor.id));
      }
    }
  }
  const existingAfterDedup = existing.length - duplicateRows.length;

  const newEntries = computeNewEntries(scraped, existingMap);
  const toUpdate = computeToUpdate(scraped, existingMap);

  console.log(`New entries to insert: ${newEntries.length} (out of ${scraped.length} scraped)`);
  console.log(`Existing rows needing update: ${toUpdate.length}`);

  const details = buildDetails(perSourceScraped, newEntries, toUpdate as any);
  console.log(
    `Per-source: ${Object.entries(details.perSource)
      .map(([k, v]) => `${k}: scraped ${v.scraped} +${v.inserted} ~${v.updated}`)
      .join(" | ")}`
  );
  if (Object.keys(details.reasonCounts).length > 0) {
    console.log(`Update reasons: ${Object.entries(details.reasonCounts).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  }

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
      const u = toUpdate[i] as any;
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
      const payload = buildLogPayload(newEntries, toUpdate as any, {
        scrapedCount: scraped.length,
        existingCount: originalExistingCount,
        totalAfter: existingAfterDedup,
        durationMs,
        status: "success",
        dryRun: false,
      });
      maybeWriteLogFile(logFilePath, payload);
    }
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: originalExistingCount,
      insertedCount: 0,
      updatedCount: 0,
      totalAfter: existingAfterDedup,
      durationMs,
      status: "success",
      error: null,
      scrapedUrl: SOURCES.map((s) => s.url).join(","),
      details,
    });
    await pool.end();
    return {
      scrapedCount: scraped.length,
      existingCount: originalExistingCount,
      insertedCount: 0,
      updatedCount: 0,
      totalAfter: existingAfterDedup,
      durationMs,
      status: "success",
      perSource: details.perSource,
      reasonCounts: details.reasonCounts,
      details,
    };
  }

  if (dryRun) {
    console.log("Dry run — not inserting/updating. Remove --dry-run to apply.");
    const durationMs = Date.now() - startMs;
    if (logFilePath) {
      const payload = buildLogPayload(newEntries, toUpdate as any, {
        scrapedCount: scraped.length,
        existingCount: originalExistingCount,
        totalAfter: existingAfterDedup,
        durationMs,
        status: "dry_run",
        dryRun: true,
      });
      (payload as any).details = details;
      maybeWriteLogFile(logFilePath, payload);
    } else if (newEntries.length + toUpdate.length > 0) {
      console.log(`\nTip: re-run with --log-file to also save these ${newEntries.length + toUpdate.length} rows to JSON (e.g. --log-file=logs/sync.json or SYNC_LOG_FILE=logs/sync.json)`);
    }
    await recordSyncRun(pool, db, {
      scrapedCount: scraped.length,
      existingCount: originalExistingCount,
      insertedCount: newEntries.length,
      updatedCount: toUpdate.length,
      totalAfter: existingAfterDedup,
      durationMs,
      status: "dry_run",
      error: null,
      scrapedUrl: SOURCES.map((s) => s.url).join(","),
      details,
    });
    await pool.end();
    return {
      scrapedCount: scraped.length,
      existingCount: originalExistingCount,
      insertedCount: newEntries.length,
      updatedCount: toUpdate.length,
      totalAfter: existingAfterDedup,
      durationMs,
      status: "dry_run",
      perSource: details.perSource,
      reasonCounts: details.reasonCounts,
      details,
    };
  }

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
    await db.insert(internships).values(batch as any);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${newEntries.length}`);
  }

  let updated = 0;
  for (const u of toUpdate as any) {
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
        applicationLink: makeKey(u.flags as any),
      })
      .where(eq(internships.id, u.id));
    updated++;
    if (updated % 100 === 0 || updated === toUpdate.length) console.log(`  updated ${updated}/${toUpdate.length}`);
  }

  const durationMs = Date.now() - startMs;
  console.log(`Done — inserted ${inserted} new, updated ${updated} existing. DB now has ${existingAfterDedup + inserted} rows`);
  if (logFilePath) {
    const payload = buildLogPayload(newEntries, toUpdate as any, {
      scrapedCount: scraped.length,
      existingCount: originalExistingCount,
      totalAfter: existingAfterDedup + inserted,
      durationMs,
      status: "success",
      dryRun: false,
    });
    (payload as any).details = details;
    maybeWriteLogFile(logFilePath, payload);
  } else if (inserted + updated > 0) {
    console.log(`Tip: re-run with --log-file to save per-row diffs to JSON (e.g. --log-file=logs/sync.json)`);
  }

  await recordSyncRun(pool, db, {
    scrapedCount: scraped.length,
    existingCount: originalExistingCount,
    insertedCount: inserted,
    updatedCount: updated,
    totalAfter: existingAfterDedup + inserted,
    durationMs,
    status: "success",
    error: null,
    scrapedUrl: SOURCES.map((s) => s.url).join(","),
    details,
  });

  await pool.end();

  return {
    scrapedCount: scraped.length,
    existingCount: originalExistingCount,
    insertedCount: inserted,
    updatedCount: updated,
    totalAfter: existingAfterDedup + inserted,
    durationMs,
    status: "success",
    perSource: details.perSource,
    reasonCounts: details.reasonCounts,
    details,
  };
}
