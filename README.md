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
npm run db:sync       # tsx scripts/sync-internships.ts — fetches SimplifyJobs and Canadian Tech README tables and upserts normalized listings
npm run db:sync:dry   # dry-run without DB writes
```

The production migration image is separate from the Next.js runtime image and contains the
Drizzle CLI plus migration files. Start Postgres, run the one-shot migration container, then
build/start the application:

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose up -d --build app
```

`migrate` exits after applying pending migrations. A non-zero exit means the application should
not be deployed until the migration problem is resolved. It does not run the internship data sync;
run `npm run db:sync` separately when an import is needed.

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

## GitHub Actions and homelab deployment

Pull requests and pushes to `main` run the `build` and `tests` checks in
`.github/workflows/ci.yml`. The test command uses `npm run test --if-present`; this
is intentionally a no-op until a test script is added to `package.json`.

After CI passes on `main`, `.github/workflows/deploy.yml` deploys through a self-hosted
runner labeled `homelab`. The runner host must have the repository checked out through
the runner, Docker access, and `/opt/intership-helper/.env.production` containing the
production database settings. The workflow starts Postgres, runs the one-shot `migrate`
container, then builds and starts the app.

To verify the runner before merging a deployment change, check that it is online under
**Settings → Actions → Runners** and that its labels include `self-hosted` and `homelab`.
Merging to `main` starts CI first; the production workflow is then triggered only when CI
finishes successfully.
