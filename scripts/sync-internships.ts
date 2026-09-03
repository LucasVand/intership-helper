import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { writeFile } from "fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { internships } from "../db/schema";

const RAW_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md";
const OUT_PATH = "internships.json";

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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const writeJson = args.includes("--write-json") || args.includes("--json");
  const verbose = args.includes("--verbose") || args.includes("-v");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: tsx scripts/sync-internships.ts [options]

Options:
  --dry-run      Fetch and report new entries without inserting
  --write-json   Also rewrite internships.json with fetched data
  --verbose      Extra logging
  --help         Show this help

Env:
  DATABASE_URL   Postgres connection (from .env). If unset, runs in dry-run/json mode only.

Examples:
  npx tsx scripts/sync-internships.ts --dry-run
  npx tsx scripts/sync-internships.ts --write-json
  npm run db:sync
  npm run db:sync:dry
`);
    process.exit(0);
  }

  console.log("Fetching internships from SimplifyJobs repo...");
  console.log(`  ${RAW_URL}`);
  const readme = await fetchReadme();
  const scraped = parseReadme(readme);
  console.log(`Found ${scraped.length} rows in README`);

  if (writeJson) {
    console.log(`Writing ${OUT_PATH}...`);
    await writeFile(OUT_PATH, JSON.stringify(scraped, null, 2), "utf8");
    console.log("  done");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn("DATABASE_URL not set — skipping DB sync (use --write-json to update file only)");
    if (!dryRun && !writeJson) {
      console.log("Tip: run with --dry-run to preview or set DATABASE_URL in .env");
    }
    // Still report what would be new vs file if no DB
    if (dryRun) {
      console.log(`Dry run: ${scraped.length} scraped entries (no DB to compare)`);
    }
    process.exit(0);
  }

  console.log(`Connecting to DB...`);
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  let existing: typeof internships.$inferSelect[];
  try {
    const rows = await db.select().from(internships);
    existing = rows;
    console.log(`DB has ${existing.length} existing internships`);
  } catch (e) {
    console.error("Failed to query DB (have you run `npm run db:migrate`?):", e);
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
    await pool.end();
    process.exit(0);
  }

  if (dryRun) {
    console.log("Dry run — not inserting/updating. Remove --dry-run to apply.");
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

  console.log(`Done — inserted ${inserted} new, updated ${updated} existing. DB now has ${existing.length + inserted} rows`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
