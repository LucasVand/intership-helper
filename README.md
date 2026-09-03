Internships browser — Next.js 16 + Tailwind + Drizzle ORM + Postgres (Docker). DB-only; no JSON fallback.

## Stack
- Next.js 16 (App Router, `output: standalone` in `next.config.ts:4`)
- Drizzle ORM + `pg` (`db/schema.ts:1`, `db/index.ts:1`)
- Postgres 16 via Docker (`docker-compose.yml:1`, `Dockerfile:1`)

## Getting Started

```bash
cp .env.example .env        # edit DATABASE_URL if needed
npm install
npm run db:setup            # create DB and sync internships from remote (required)
npm run dev                 # http://localhost:3000 — requires DB
```

## Database + Docker

**Env** (` .env.example:1`, `.env:1` — gitignored, example committed):
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/intership-helper
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=intership-helper
POSTGRES_PORT=5432
```

**Drizzle** (`drizzle.config.ts:1` reads `DATABASE_URL`):
```bash
npm run db:generate   # drizzle-kit generate — creates ./drizzle/*.sql (already has 0000_real_tattoo.sql)
npm run db:push       # drizzle-kit push — push schema directly (dev, no SQL)
npm run db:migrate    # drizzle-kit migrate — apply generated SQL
npm run db:studio     # drizzle-kit studio --port 4983 — GUI on http://localhost:4983
npm run db:sync       # tsx scripts/sync-internships.ts — fetches SimplifyJobs README and upserts (insert + flag backfill)
npm run db:sync:dry   # dry-run without DB writes
```

**Docker** (requires Docker daemon):
```bash
npm run docker:up     # docker compose up --build — starts db (postgres) + app (Next standalone on :3000)
npm run docker:down   # docker compose down
# or manually:
docker compose up -d db             # only postgres on :5432
npx drizzle-kit migrate             # apply migrations
npm run db:sync       # fetch and insert new internships
```

API: `GET /api/internships` (`app/api/internships/route.ts:1`) — DB-only (503 if `DATABASE_URL` not set). Run `npm run db:setup` first.

## Scripts
- `npm run dev` / `build` / `start` / `lint`
- `npm run db:*` / `npm run docker:*` (see above)
