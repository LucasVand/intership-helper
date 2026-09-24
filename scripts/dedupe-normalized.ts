/**
 * Dedupe after URL-normalization removal.
 *
 * Before `45a61aa` links were normalized:
 *   lowercased proto/host, stripped default ports, stripped trailing slash,
 *   stripped hash, removed utm_* / fbclid / gclid etc, sorted params.
 * After `45a61aa` links are stored raw (trim only). A single sync therefore
 * inserted ~1500 raw rows alongside ~1000 normalized rows. Many raw+normalized
 * pairs collapse to the same old-normalized key.
 *
 * This script groups by the OLD normalizer, and for each group with >1 row
 * keeps the UNNORMALIZED (raw) variant, deletes the normalized variant(s),
 * merging applied/disliked/flags onto the survivor.
 *
 * Usage:
 *   npx tsx scripts/dedupe-normalized.ts --dry-run   # report only
 *   npx tsx scripts/dedupe-normalized.ts --apply      # delete + merge
 *   DATABASE_URL=... npx tsx scripts/dedupe-normalized.ts --apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { internships } from "../db/schema";
import { getDatabaseUrl } from "./sync-core";

// --- OLD normalizer (pre-45a61aa, bab9786:scripts/normalize-url.ts) ---
const TRACKING_PARAMETER = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|igshid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;
function oldNormalize(link: string): string {
  const trimmed = link.trim();
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const params = [...url.searchParams.entries()]
      .filter(([name]) => !TRACKING_PARAMETER.test(name))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [name, value] of params) url.searchParams.append(name, value);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed.split("#", 1)[0];
  }
}
function isNormalized(link: string): boolean {
  return link.trim() === oldNormalize(link);
}
function isRaw(link: string): boolean {
  return !isNormalized(link);
}

type Row = typeof internships.$inferSelect;

function pickSurvivor(rows: Row[]): Row {
  // Prefer raw (un-normalized) over normalized, then applied/disliked, then flags, then lowest id
  const scored = rows.map((r) => {
    const raw = isRaw(r.applicationLink);
    return {
      row: r,
      score: [
        raw ? 0 : 1, // raw first
        r.applied || r.disliked ? 0 : 1, // keep user state
        r.isFaang || r.isClosed ? 0 : 1,
        r.id, // tie-break stable
      ],
    };
  });
  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) {
      if (a.score[i] !== b.score[i]) return (a.score[i] as number) - (b.score[i] as number);
    }
    return 0;
  });
  return scored[0].row;
}

function mergeFlags(survivor: Row, duplicates: Row[]): Partial<Row> {
  const merged: Partial<Row> = {};
  // OR all boolean flags so user state is not lost
  (merged as any).applied = survivor.applied || duplicates.some((d) => d.applied);
  (merged as any).disliked = survivor.disliked || duplicates.some((d) => d.disliked);
  (merged as any).noSponsorship = survivor.noSponsorship || duplicates.some((d) => d.noSponsorship);
  (merged as any).requiresCitizenship = survivor.requiresCitizenship || duplicates.some((d) => d.requiresCitizenship);
  (merged as any).isClosed = survivor.isClosed || duplicates.some((d) => d.isClosed);
  (merged as any).isFaang = survivor.isFaang || duplicates.some((d) => d.isFaang);
  (merged as any).requiresAdvancedDegree = survivor.requiresAdvancedDegree || duplicates.some((d) => d.requiresAdvancedDegree);
  // source: if any differs, set to multiple
  const sources = new Set([survivor.source, ...duplicates.map((d) => d.source)]);
  (merged as any).source = sources.size > 1 ? "multiple" : survivor.source;
  return merged;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");
  const verbose = args.includes("--verbose");

  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.error("Database configuration missing — set DATABASE_URL or POSTGRES_*");
    process.exit(1);
  }

  console.log(`Dedupe via OLD normalizer (keep RAW, delete NORMALIZED) — mode: ${dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  console.log(`DB: ${dbUrl.replace(/:\/\/.*@/, "://***@")}`);

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  const rows = await db.select().from(internships);
  console.log(`Loaded ${rows.length} rows`);

  // Group by old normalized key
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = oldNormalize(r.applicationLink);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const duplicateGroups = [...groups.entries()].filter(([, v]) => v.length > 1);
  const totalDupRows = duplicateGroups.reduce((sum, [, v]) => sum + v.length - 1, 0);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate groups via OLD normalizer — nothing to do");
    console.log("Tip: if you still see duplicates via UI (same company/role), they may not collapse via utm/hash/slash/case normalization.");
    console.log("Consider grouping by oldNormalize + case-insensitive, or by company|role|location. Run with --verbose to see breakdown.");
    await pool.end();
    return;
  }

  console.log(`Found ${duplicateGroups.length} groups, ${totalDupRows} rows to delete`);

  let keptRaw = 0;
  let keptNorm = 0;
  let toDeleteIds: number[] = [];
  let toUpdate: Array<{ survivor: Row; duplicates: Row[]; merged: Partial<Row> }> = [];

  for (const [key, group] of duplicateGroups) {
    const survivor = pickSurvivor(group);
    const duplicates = group.filter((r) => r.id !== survivor.id);
    const rawSurvivor = isRaw(survivor.applicationLink);
    if (rawSurvivor) keptRaw++;
    else keptNorm++;

    const merged = mergeFlags(survivor, duplicates);
    const needsUpdate =
      merged.applied !== survivor.applied ||
      merged.disliked !== survivor.disliked ||
      merged.noSponsorship !== survivor.noSponsorship ||
      merged.requiresCitizenship !== survivor.requiresCitizenship ||
      merged.isClosed !== survivor.isClosed ||
      merged.isFaang !== survivor.isFaang ||
      merged.requiresAdvancedDegree !== survivor.requiresAdvancedDegree ||
      merged.source !== survivor.source;

    if (needsUpdate) toUpdate.push({ survivor, duplicates, merged });
    toDeleteIds.push(...duplicates.map((d) => d.id));

    if (verbose || duplicateGroups.length <= 20) {
      console.log(`\nGroup key: ${key}`);
      console.log(`  KEEP id=${survivor.id} ${rawSurvivor ? "RAW" : "NORM"} ${survivor.applicationLink.slice(0, 100)} ${survivor.applied ? "[applied]" : ""} ${survivor.disliked ? "[disliked]" : ""}`);
      for (const d of duplicates) {
        console.log(`  DEL  id=${d.id} ${isRaw(d.applicationLink) ? "RAW" : "NORM"} ${d.applicationLink.slice(0, 100)} ${d.applied ? "[applied]" : ""} ${d.disliked ? "[disliked]" : ""}`);
      }
      if (needsUpdate) console.log(`  MERGE flags -> applied=${merged.applied} disliked=${merged.disliked} source=${merged.source}`);
    }
  }

  console.log(`\nSummary: groups ${duplicateGroups.length}, delete ${toDeleteIds.length}, update ${toUpdate.length} survivors`);
  console.log(`Keep breakdown: RAW ${keptRaw} / NORM ${keptNorm} (RAW preferred)`);
  // Breakdown of why raw vs norm
  const rawNormCounts = { both: 0, onlyRaw: 0, onlyNorm: 0 };
  for (const [, group] of duplicateGroups) {
    const hasRaw = group.some((r) => isRaw(r.applicationLink));
    const hasNorm = group.some((r) => isNormalized(r.applicationLink));
    if (hasRaw && hasNorm) rawNormCounts.both++;
    else if (hasRaw) rawNormCounts.onlyRaw++;
    else rawNormCounts.onlyNorm++;
  }
  console.log(`Groups with both RAW+NORM: ${rawNormCounts.both}, only RAW: ${rawNormCounts.onlyRaw}, only NORM: ${rawNormCounts.onlyNorm}`);

  if (dryRun) {
    console.log("\nDRY RUN — no writes. Re-run with --apply to delete normalized duplicates and keep raw.");
    console.log("Example: npx tsx scripts/dedupe-normalized.ts --apply");
    await pool.end();
    return;
  }

  // Apply: delete then update survivors in transaction-like batches
  console.log(`\nApplying... deleting ${toDeleteIds.length} rows`);
  const batchSize = 500;
  for (let i = 0; i < toDeleteIds.length; i += batchSize) {
    const batch = toDeleteIds.slice(i, i + batchSize);
    await db.delete(internships).where(inArray(internships.id, batch));
    console.log(`  deleted ${Math.min(i + batchSize, toDeleteIds.length)}/${toDeleteIds.length}`);
  }

  for (const { survivor, merged } of toUpdate) {
    await db
      .update(internships)
      .set(merged as any)
      .where(eq(internships.id, survivor.id));
  }
  if (toUpdate.length > 0) console.log(`  updated ${toUpdate.length} survivors with merged flags`);

  const remaining = await db.select().from(internships);
  console.log(`Done. DB now has ${remaining.length} rows (was ${rows.length}, -${toDeleteIds.length})`);

  await pool.end();
}

if (require.main === module || process.argv[1]?.includes("dedupe-normalized")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
