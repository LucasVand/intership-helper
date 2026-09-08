import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";

function getKeepCount(): number {
  const raw = process.env.SYNC_KEEP_COUNT ?? process.env.SYNC_MAX_LOGS ?? "20";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 20;
}

function pruneLogFiles() {
  const keep = getKeepCount();
  const dir = "logs";
  if (!fs.existsSync(dir)) {
    console.log(`prune: ${dir}/ does not exist — nothing to prune`);
    return;
  }
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("sync-") && f.endsWith(".json") && f !== "sync-latest.json")
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        return { file: full, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { file: string; mtimeMs: number }[];

  console.log(`prune: found ${entries.length} archived log(s) in ${dir}/, keeping ${keep} most recent`);
  if (entries.length <= keep) return;

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toDelete = entries.slice(keep);
  let removed = 0;
  for (const { file } of toDelete) {
    try {
      fs.unlinkSync(file);
      console.log(`  removed ${file}`);
      removed++;
    } catch (e: any) {
      console.warn(`  failed to remove ${file}: ${e?.message ?? e}`);
    }
  }
  console.log(`prune: removed ${removed} old file(s), kept ${keep}`);
}

function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;
  const host = process.env.POSTGRES_HOST ?? "db";
  const port = process.env.POSTGRES_PORT ?? "5432";
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(POSTGRES_DB)}`;
}

async function pruneDb() {
  const keep = getKeepCount();
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    console.log("prune: no DATABASE_URL — skipping DB prune");
    return;
  }
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(
      `DELETE FROM "sync_runs" WHERE id NOT IN (SELECT id FROM "sync_runs" ORDER BY "created_at" DESC, "id" DESC LIMIT $1)`,
      [keep]
    );
    const deleted = (res as any)?.rowCount ?? 0;
    if (deleted > 0) console.log(`prune: DB sync_runs — removed ${deleted} old row(s), kept ${keep} most recent`);
    else console.log(`prune: DB sync_runs — no rows to remove (keeping ${keep})`);
  } catch (e: any) {
    if (String(e?.message ?? "").includes("does not exist") || String(e?.code) === "42P01") {
      console.log("prune: sync_runs table does not exist — skipping DB prune (run db:migrate first)");
      return;
    }
    console.warn(`prune: DB prune failed: ${String(e?.message ?? e).slice(0, 300)}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: tsx scripts/prune-sync-history.ts [options]

Prunes old sync history to keep only the most recent N entries (default 20).

Options:
  --help, -h   Show this help

Env:
  SYNC_KEEP_COUNT / SYNC_MAX_LOGS   Number to keep (default 20, max 1000)
  DATABASE_URL / POSTGRES_*         DB connection for sync_runs prune
  LOGS_DIR                          Not used — always ./logs

What it does:
  - File: keeps 20 most recent logs/sync-*.json (excludes logs/sync-latest.json which is always kept)
          oldest files by mtime are deleted.
  - DB:   DELETE FROM sync_runs WHERE id NOT IN (SELECT ... ORDER BY created_at DESC LIMIT 20)

Examples:
  npx tsx scripts/prune-sync-history.ts
  SYNC_KEEP_COUNT=20 npx tsx scripts/prune-sync-history.ts
  npm run db:prune
`);
    process.exit(0);
  }
  pruneLogFiles();
  await pruneDb();
  console.log("prune: done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
