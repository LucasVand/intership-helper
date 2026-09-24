import { NextResponse } from "next/server";
import { db } from "@/db";

// re-use the same logic as the CLI script, but as a callable function
// we import the helpers to avoid duplicating code
import {
  getDatabaseUrl,
  makeKey,
  buildDetails,
  findDuplicateRows,
} from "@/scripts/sync-internships";
import { normalizeApplicationLink } from "@/scripts/normalize-url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { internships, syncRuns } from "@/db/schema";
import { canadianTechSource } from "@/scripts/sources/canadian-tech";
import { simplifySource } from "@/scripts/sources/simplify";
import type { ScrapedInternship } from "@/scripts/sources/types";

export const dynamic = "force-dynamic";

const SOURCES = [simplifySource, canadianTechSource] as const;

async function runSyncCore(dryRun: boolean) {
  const startMs = Date.now();
  const perSourceScraped: Record<string, number> = {};
  let scraped: ScrapedInternship[] = [];

  // fetch
  const batches = await Promise.all(
    SOURCES.map(async (source) => {
      const rows = await source.fetchAndParse();
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

  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error("Database not configured");
  }
  const pool = new Pool({ connectionString });
  const drizzleDb = drizzle(pool);

  const existing = await drizzleDb.select().from(internships);

  // dedupe existing
  const { existingMap, duplicateRows } = findDuplicateRows(existing as any);

  if (duplicateRows.length > 0 && !dryRun) {
    await drizzleDb.delete(internships).where(inArray(internships.id, duplicateRows.map(({ duplicate }) => duplicate.id)));
    for (const { survivor } of duplicateRows) {
      await drizzleDb
        .update(internships)
        .set({
          applicationLink: makeKey(survivor as any),
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
  const existingAfterDedup = existing.length - duplicateRows.length;

  // new entries
  const seenScrapedLinks = new Set<string>();
  const newEntries = scraped.filter((r) => {
    const link = makeKey(r);
    if (!link || existingMap.has(link) || seenScrapedLinks.has(link)) return false;
    seenScrapedLinks.add(link);
    return true;
  });

  // toUpdate
  const toUpdate: Array<{
    id: number;
    flags: ScrapedInternship;
    cleanCompany: string;
    cleanRole: string;
    source: string;
    reasons: string[];
    existing: any;
  }> = [];
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
    // inline flagLabel to avoid import cycle
    const flagLabel = (k: string, before: boolean, after: boolean) => {
      const emoji: Record<string, string> = {
        noSponsorship: "🛂",
        requiresCitizenship: "🇺🇸",
        isClosed: "🔒",
        isFaang: "🔥",
        requiresAdvancedDegree: "🎓",
      };
      return `${k}${emoji[k] ? ` ${emoji[k]}` : ""}: ${before ? "true" : "false"}→${after ? "true" : "false"}`;
    };
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

  const details = buildDetails(perSourceScraped, newEntries, toUpdate as any);

  // if dryRun, don't write
  if (dryRun) {
    const durationMs = Date.now() - startMs;
    try {
      await drizzleDb.insert(syncRuns).values({
        scrapedCount: scraped.length,
        existingCount: existing.length,
        insertedCount: newEntries.length,
        updatedCount: toUpdate.length,
        totalAfter: existingAfterDedup,
        durationMs,
        status: "dry_run",
        error: null,
        scrapedUrl: SOURCES.map((s) => s.url).join(","),
        source: "combined",
        details: details as any,
      } as any);
    } catch {}
    await pool.end();
    return {
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: newEntries.length,
      updatedCount: toUpdate.length,
      totalAfter: existingAfterDedup,
      durationMs,
      status: "dry_run" as const,
      perSource: details.perSource,
      reasonCounts: details.reasonCounts,
      details,
    };
  }

  // real insert
  let inserted = 0;
  const batchSize = 500;
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
    await drizzleDb.insert(internships).values(batch as any);
    inserted += batch.length;
  }
  let updated = 0;
  for (const u of toUpdate) {
    await drizzleDb
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
  }

  const durationMs = Date.now() - startMs;
  const totalAfter = existingAfterDedup + inserted;
  try {
    await drizzleDb.insert(syncRuns).values({
      scrapedCount: scraped.length,
      existingCount: existing.length,
      insertedCount: inserted,
      updatedCount: updated,
      totalAfter,
      durationMs,
      status: "success",
      error: null,
      scrapedUrl: SOURCES.map((s) => s.url).join(","),
      source: "combined",
      details: details as any,
    } as any);
  } catch {}
  await pool.end();

  return {
    scrapedCount: scraped.length,
    existingCount: existing.length,
    insertedCount: inserted,
    updatedCount: updated,
    totalAfter,
    durationMs,
    status: "success" as const,
    perSource: details.perSource,
    reasonCounts: details.reasonCounts,
    details,
  };
}

export async function POST(req: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured — set DATABASE_URL and run npm run db:setup" }, { status: 503 });
  }

  let dryRun = false;
  try {
    const url = new URL(req.url);
    const qDry = url.searchParams.get("dryRun") || url.searchParams.get("dry_run");
    if (qDry === "true" || qDry === "1") dryRun = true;
    // also allow JSON body
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.clone().json().catch(() => ({}));
      if (body && (body.dryRun === true || body.dry_run === true)) dryRun = true;
    }
  } catch {}

  try {
    const result = await runSyncCore(dryRun);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("POST /api/sync failed:", e);
    // try to record failure
    try {
      if (db) {
        const pool = new Pool({ connectionString: getDatabaseUrl()! });
        const drizzleDb = drizzle(pool);
        await drizzleDb.insert(syncRuns).values({
          scrapedCount: 0,
          existingCount: 0,
          insertedCount: 0,
          updatedCount: 0,
          totalAfter: 0,
          durationMs: 0,
          status: "failed",
          error: String(e?.message ?? e).slice(0, 2000),
          scrapedUrl: SOURCES.map((s) => s.url).join(","),
          source: "combined",
          details: { error: String(e?.message ?? e).slice(0, 500) } as any,
        } as any);
        await pool.end();
      }
    } catch {}
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 500) }, { status: 500 });
  }
}

export async function GET() {
  // also allow GET for dryRun quick check
  return POST(new Request("http://localhost/api/sync?dryRun=true"));
}
