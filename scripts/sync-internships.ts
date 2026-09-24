import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import { getDatabaseUrl, getLogFilePath, runSync } from "./sync-core";

// Re-export helpers for backwards compat (tests import from this file)
export * from "./sync-core";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const logFilePath = getLogFilePath(args);

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

  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.error("Database configuration missing — set DATABASE_URL or POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB.");
    process.exit(1);
  }

  try {
    await runSync({ dbUrl, dryRun, logFilePath });
  } catch (e: any) {
    console.error(e?.message ?? e);
    process.exit(1);
  }
}

if (process.argv[1]?.includes("sync-internships")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
