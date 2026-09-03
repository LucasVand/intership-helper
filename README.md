Internships browser for `internships.json` — Next.js 16 + Tailwind + Drizzle ORM + Postgres (Docker).

## Stack
- Next.js 16 (App Router, `output: standalone` in `next.config.ts:4`)
- Drizzle ORM + `pg` (`db/schema.ts:1`, `db/index.ts:1`)
- Postgres 16 via Docker (`docker-compose.yml:1`, `Dockerfile:1`)

## Getting Started

```bash
cp .env.example .env        # edit DATABASE_URL if needed
npm install
npm run dev                 # http://localhost:3000 — reads internships.json by default
```

## Database + Docker

**Env** (` .env.example:1`, `.env:1` — gitignored, example committed):
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jobs
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=jobs
POSTGRES_PORT=5432
```

**Drizzle** (`drizzle.config.ts:1` reads `DATABASE_URL`):
```bash
npm run db:generate   # drizzle-kit generate — creates ./drizzle/*.sql (already has 0000_real_tattoo.sql)
npm run db:push       # drizzle-kit push — push schema directly (dev, no SQL)
npm run db:migrate    # drizzle-kit migrate — apply generated SQL
npm run db:studio     # drizzle-kit studio --port 4983 — GUI on http://localhost:4983
npm run db:seed       # tsx scripts/seed.ts — inserts internships.json (1072 rows, batch 500)
npm run db:seed:clear # clears table then seeds
```

**Docker** (requires Docker daemon):
```bash
npm run docker:up     # docker compose up --build — starts db (postgres) + app (Next standalone on :3000)
npm run docker:down   # docker compose down
# or manually:
docker compose up -d db             # only postgres on :5432
npx drizzle-kit migrate             # apply migrations
npm run db:seed
```

API: `GET /api/internships` (`app/api/internships/route.ts:1`) — tries DB first, falls back to `internships.json` if `DATABASE_URL` unset or query fails.

## Scripts
- `npm run dev` / `build` / `start` / `lint`
- `npm run db:*` / `npm run docker:*` (see above)
