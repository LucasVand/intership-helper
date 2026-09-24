#!/usr/bin/env node
// Standalone dedupe — no repo imports, only pg. Groups by OLD normalizer, keeps RAW.
// Usage: DATABASE_URL=... node dedupe-standalone.mjs --dry-run --verbose
//        DATABASE_URL=... node dedupe-standalone.mjs --apply
import pg from "pg";
const { Pool } = pg;

const TRACKING_PARAMETER = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|igshid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;
function oldNormalize(link) {
  const trimmed = link.trim();
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const params = [...url.searchParams.entries()].filter(([n]) => !TRACKING_PARAMETER.test(n)).sort(([a],[b])=>a.localeCompare(b));
    url.search = "";
    for (const [n,v] of params) url.searchParams.append(n,v);
    url.hash = "";
    return url.toString();
  } catch { return trimmed.split("#",1)[0]; }
}
const isRaw = (l) => l.trim() !== oldNormalize(l);

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const verbose = args.includes("--verbose");
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set DATABASE_URL"); process.exit(1); }
console.log(`Dedupe OLD normalizer — keep RAW, delete NORM — ${dryRun ? "DRY RUN" : "APPLY"}`);
const pool = new Pool({ connectionString: dbUrl });
const { rows } = await pool.query("SELECT * FROM internships");
console.log(`Loaded ${rows.length} rows`);
const groups = new Map();
for (const r of rows) {
  const k = oldNormalize(r.application_link);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const dups = [...groups.entries()].filter(([,v])=>v.length>1);
if (dups.length===0) { console.log("No duplicate groups via OLD normalizer — nothing to do"); await pool.end(); process.exit(0); }
console.log(`Found ${dups.length} groups, ${dups.reduce((s,[,v])=>s+v.length-1,0)} rows to delete`);
let toDelete = [];
for (const [key, group] of dups) {
  group.sort((a,b)=>{
    const ar = isRaw(a.application_link) ? 0 : 1;
    const br = isRaw(b.application_link) ? 0 : 1;
    if (ar!==br) return ar-br;
    const af = (a.applied||a.disliked) ? 0 : 1;
    const bf = (b.applied||b.disliked) ? 0 : 1;
    if (af!==bf) return af-bf;
    return a.id - b.id;
  });
  const survivor = group[0];
  const dels = group.slice(1);
  if (verbose) {
    console.log(`\nGroup: ${key}`);
    console.log(`  KEEP id=${survivor.id} ${isRaw(survivor.application_link)?"RAW":"NORM"} ${survivor.application_link.slice(0,120)}`);
    for (const d of dels) console.log(`  DEL  id=${d.id} ${isRaw(d.application_link)?"RAW":"NORM"} ${d.application_link.slice(0,120)}`);
  }
  // merge flags onto survivor if needed
  let needUpdate = false;
  const merged = {};
  for (const f of ["applied","disliked","no_sponsorship","requires_citizenship","is_closed","is_faang","requires_advanced_degree"]) {
    const v = survivor[f] || dels.some(d=>d[f]);
    if (v !== survivor[f]) { merged[f]=v; needUpdate=true; }
  }
  const sources = new Set([survivor.source, ...dels.map(d=>d.source)]);
  if (sources.size>1 && survivor.source!=="multiple") { merged.source="multiple"; needUpdate=true; }
  if (needUpdate && !dryRun) {
    const sets = Object.entries(merged).map(([k],i)=>`${k}=$${i+1}`).join(", ");
    const vals = Object.values(merged);
    await pool.query(`UPDATE internships SET ${sets} WHERE id=$${vals.length+1}`, [...vals, survivor.id]);
    if (verbose) console.log(`  -> merged flags ${JSON.stringify(merged)}`);
  }
  toDelete.push(...dels.map(d=>d.id));
}
console.log(`\nSummary: delete ${toDelete.length}, update survivors as needed`);
if (dryRun) { console.log("DRY RUN — re-run with --apply to delete"); await pool.end(); process.exit(0); }
console.log(`Deleting ${toDelete.length}...`);
for (let i=0;i<toDelete.length;i+=500) {
  const batch = toDelete.slice(i,i+500);
  await pool.query(`DELETE FROM internships WHERE id = ANY($1)`, [batch]);
  console.log(`  deleted ${Math.min(i+500,toDelete.length)}/${toDelete.length}`);
}
const { rows: remain } = await pool.query("SELECT count(*) FROM internships");
console.log(`Done. Now ${remain[0].count} rows (was ${rows.length}, -${toDelete.length})`);
await pool.end();
