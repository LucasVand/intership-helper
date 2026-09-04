import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { internships, syncRuns } from "../db/schema";

const RAW_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md";

function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;

  const host = process.env.POSTGRES_HOST ?? "db";
  const port = process.env.POSTGRES_PORT ?? "5432";
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(POSTGRES_DB)}`;
}

type ScrapedInternship = {
  company: string;
  role: string;
  location: string;
  application_links: string[];
  age?: string;
  no_sponsorship?: boolean;
  requires_citizenship?: boolean;
  is_closed?: boolean;
  is_faang?: boolean;
  requires_advanced_degree?: boolean;
};

async function fetchReadme(): Promise<string> {
  const res = await fetch(RAW_URL, { headers: { "User-Agent": "node.js" } });
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status} ${res.statusText}`);
  return await res.text();
}

function extractFlags(text: string) {
  return {
    noSponsorship: text.includes("🛂"),
    requiresCitizenship: text.includes("🇺🇸"),
    isClosed: text.includes("🔒"),
    isFaang: text.includes("🔥"),
    requiresAdvancedDegree: text.includes("🎓"),
  };
}

function cleanText(text: string): string {
  return text
    .replace(/🛂/g, "")
    .replace(/🇺🇸/g, "")
    .replace(/🔒/g, "")
    .replace(/🔥/g, "")
    .replace(/🎓/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

function parseReadme(mdOrHtml: string): ScrapedInternship[] {
  const $ = cheerio.load(mdOrHtml);
  const rows = $("table tbody tr");
  const result: ScrapedInternship[] = [];
  let lastCompany = "";
  let lastFlags = { noSponsorship: false, requiresCitizenship: false, isClosed: false, isFaang: false, requiresAdvancedDegree: false };

  rows.each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length === 0) return;

    const companyCell = $(tds.get(0));
    const rawCompanyFull = companyCell.text().trim();
    const rawCompanyLink = companyCell.find("a").first().text().trim() || rawCompanyFull;
    const isContinuation = /^↳/.test(rawCompanyFull) || /^↳/.test(rawCompanyLink) || rawCompanyFull === "↳";

    let company: string;
    let companyFlags = { noSponsorship: false, requiresCitizenship: false, isClosed: false, isFaang: false, requiresAdvancedDegree: false };
    if (isContinuation) {
      company = lastCompany;
      companyFlags = lastFlags;
    } else {
      const flags = extractFlags(rawCompanyFull);
      companyFlags = flags;
      company = cleanText(rawCompanyLink || rawCompanyFull);
      if (company) {
        lastCompany = company;
        lastFlags = flags;
      }
    }

    const rawRole = $(tds.get(1)).text().trim();
    const roleFlags = extractFlags(rawRole);
    const role = cleanText(rawRole);
    const location = $(tds.get(2)).text().replace(/\n+/g, ", ").replace(/\s+,/g, ",").trim();

    const applicationLinks: string[] = [];
    if (tds.length >= 4) {
      $(tds.get(3))
        .find("a")
        .each((__, a) => {
          const href = $(a).attr("href");
          if (href) applicationLinks.push(href.trim());
        });
    }

    const age = tds.length >= 5 ? $(tds.get(4)).text().trim() : undefined;
    if (!company && !role) return;

    const flagsCombined = {
      no_sponsorship: companyFlags.noSponsorship || roleFlags.noSponsorship,
      requires_citizenship: companyFlags.requiresCitizenship || roleFlags.requiresCitizenship,
      is_closed: companyFlags.isClosed || roleFlags.isClosed,
      is_faang: companyFlags.isFaang || roleFlags.isFaang,
      requires_advanced_degree: companyFlags.requiresAdvancedDegree || roleFlags.requiresAdvancedDegree,
    };

    result.push({
      company,
      role,
      location,
      application_links: applicationLinks,
      age,
      no_sponsorship: flagsCombined.no_sponsorship || undefined,
      requires_citizenship: flagsCombined.requires_citizenship || undefined,
      is_closed: flagsCombined.is_closed || undefined,
      is_faang: flagsCombined.is_faang || undefined,
      requires_advanced_degree: flagsCombined.requires_advanced_degree || undefined,
    });
  });

  return result;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanForKey(s: string): string {
  return normalize(
    s
      .replace(/🛂/g, "")
      .replace(/🇺🇸/g, "")
      .replace(/🔒/g, "")
      .replace(/🔥/g, "")
      .replace(/🎓/g, "")
      .trim()
  );
}

function makeKey(r: { company: string; role: string; location: string; application_links?: string[]; applicationLinks?: string[] }): string {
  const links = (r.application_links ?? r.applicationLinks ?? []).map((s) => s.trim()).sort().join("|");
  return `${cleanForKey(r.company)}|${cleanForKey(r.role)}|${normalize(r.location)}|${links}`;
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

  console.log("Fetching internships from SimplifyJobs repo...");
  console.log(`  ${RAW_URL}`);
  let scraped: ScrapedInternship[] = [];
  try {
    const readme = await fetchReadme();
    scraped = parseReadme(readme);
  } catch (e: any) {
    console.error("Failed to fetch/parse README:", e?.message ?? e);
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
          scrapedUrl: RAW_URL,
        });
        await pool.end();
      } catch {}
    }
    process.exit(1);
  }
  console.log(`Found ${scraped.length} rows in README`);

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
        scrapedUrl: RAW_URL,
      });
    } catch {}
    await pool.end();
    process.exit(1);
  }

  const existingMap = new Map<string, typeof existing[number]>();
  for (const r of existing) {
    existingMap.set(makeKey({ company: r.company, role: r.role, location: r.location, applicationLinks: r.applicationLinks }), r);
  }
  if (verbose) console.log(`  built ${existingMap.size} existing keys`);

  const newEntries = scraped.filter((r) => !existingMap.has(makeKey(r)));

  // Also detect existing rows where legend flags or cleaned text have changed (backfill)
  const toUpdate: Array<{ id: number; flags: ScrapedInternship; cleanCompany: string; cleanRole: string }> = [];
  for (const s of scraped) {
    const key = makeKey(s);
    const ex = existingMap.get(key);
    if (!ex) continue;
    const sFlags = {
      noSponsorship: Boolean(s.no_sponsorship),
      requiresCitizenship: Boolean(s.requires_citizenship),
      isClosed: Boolean(s.is_closed),
      isFaang: Boolean(s.is_faang),
      requiresAdvancedDegree: Boolean(s.requires_advanced_degree),
    };
    const needsFlagUpdate =
      ex.noSponsorship !== sFlags.noSponsorship ||
      ex.requiresCitizenship !== sFlags.requiresCitizenship ||
      ex.isClosed !== sFlags.isClosed ||
      ex.isFaang !== sFlags.isFaang ||
      ex.requiresAdvancedDegree !== sFlags.requiresAdvancedDegree;
    const needsTextUpdate = ex.company !== s.company || ex.role !== s.role;
    if (needsFlagUpdate || needsTextUpdate) {
      toUpdate.push({ id: ex.id, flags: s, cleanCompany: s.company, cleanRole: s.role });
    }
  }

  console.log(`New entries to insert: ${newEntries.length} (out of ${scraped.length} scraped)`);
  console.log(`Existing rows needing flag update: ${toUpdate.length}`);
  if (verbose && newEntries.length) {
    newEntries.slice(0, 10).forEach((e) => console.log(`  + ${e.company} — ${e.role} — ${e.location} ${e.is_faang ? "🔥" : ""}${e.requires_advanced_degree ? "🎓" : ""}`));
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
      scrapedUrl: RAW_URL,
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
      scrapedUrl: RAW_URL,
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
      applicationLinks: row.application_links,
      age: row.age ?? null,
      applied: false,
      noSponsorship: Boolean(row.no_sponsorship),
      requiresCitizenship: Boolean(row.requires_citizenship),
      isClosed: Boolean(row.is_closed),
      isFaang: Boolean(row.is_faang),
      requiresAdvancedDegree: Boolean(row.requires_advanced_degree),
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
        noSponsorship: Boolean(u.flags.no_sponsorship),
        requiresCitizenship: Boolean(u.flags.requires_citizenship),
        isClosed: Boolean(u.flags.is_closed),
        isFaang: Boolean(u.flags.is_faang),
        requiresAdvancedDegree: Boolean(u.flags.requires_advanced_degree),
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
    scrapedUrl: RAW_URL,
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
        scrapedUrl: RAW_URL,
      });
      await pool.end();
    }
  } catch {}
  process.exit(1);
});
