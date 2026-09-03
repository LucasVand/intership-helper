<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Architecture — intership-helper

Internships browser (~1k SWE internships, Summer 2027) — DB-only. Search, filter, paginate, track `applied`, and surface Top Picks via keyword match. All routes require Postgres (`npm run db:setup`); no JSON fallback.

## Stack

- Next.js 16 App Router (`next.config.ts:3` `output: standalone`, `app/layout.tsx:20`, `app/globals.css:1` Tailwind 4 + `Geist` fonts)
- React 19, TypeScript 5.9 (`tsconfig.json:7` `paths @/*`)
- Drizzle ORM 0.45 + `pg` Pool (`db/index.ts:1`, `db/schema.ts:1`, `drizzle.config.ts:7`)
- Postgres 16 Alpine (`docker-compose.yml:2`, `Dockerfile:1`, `drizzle/*.sql`)

## Project Structure

```
app/
  layout.tsx              # root layout, Geist fonts, metadata
  page.tsx                # client page: search, filters, Top Picks, grids
  components/InternshipCard.tsx  # card + LegendBadges
  api/
    internships/route.ts  # GET (list + filters + pagination), PATCH (applied)
    top-picks/route.ts    # GET keyword-matched + tag-filtered Top Picks
    keywords/route.ts     # CRUD for Top Pick keywords
db/
  schema.ts               # internships, topPickKeywords tables
  index.ts                # pool + drizzle, null when DATABASE_URL missing
drizzle/                  # generated SQL migrations + meta
internships.json          # legacy snapshot (~1072 rows, not used at runtime — DB is source of truth)
scripts/
  sync-internships.ts     # scrape/sync + flag parsing (seeds DB on first run, DB-only)
  scrape_internships.ts
  wait-for-db.sh
```

## Data Model

### Source `internships.json` (legacy snapshot)

File `internships.json` (~1072 rows) is a legacy snapshot of the remote SimplifyJobs README; it is no longer read at runtime (DB is sole source). Each entry shape was `{company, role, location, application_links: string[], age?: string, ...flags}`. Now `npm run db:sync` fetches the remote README and upserts directly into Postgres; `internships.json` remains in repo for reference only.

### DB `db/schema.ts:3`

- `internships` pgTable: `id serial PK`, `company/role/location text NotNull`, `applicationLinks text[] NotNull`, `age text`, `applied bool default false`, five legend flags `noSponsorship`, `requiresCitizenship`, `isClosed`, `isFaang`, `requiresAdvancedDegree` all `bool NotNull default false` (`db/schema.ts:14-18`), `createdAt timestamp`. Indexes on `company, age, applied, is_faang, is_closed` (`db/schema.ts:22-26`).
- `topPickKeywords` pgTable (`db/schema.ts:33`): `id serial PK`, `keyword text unique NotNull`, `createdAt`. This is the user-defined filter set for Top Picks (global, stored in Postgres).

### DB Connection `db/index.ts:11`

`DATABASE_URL` → `new Pool` → `drizzle(pool, {schema})`. If unset, `db` is `null` and all API routes return `503 Database not configured` (no JSON fallback). SSL disabled for localhost/db host.

## API Layer

All routes `export const dynamic = "force-dynamic"`.

### `GET /api/internships` (`app/api/internships/route.ts:32`)

DB-only — 503 if `DATABASE_URL` missing. Parses `q, age, applied (all/applied/not_applied), sort (newest/oldest/company/role)`, `page/limit` (limit capped 100, `app/api/internships/route.ts:95`), and five tag filters (`TagFilter = all|only|exclude`, `app/api/internships/route.ts:23-30`, parsed via `parseTagFilter` which accepts `only/true/1` and `exclude/hide/false/0`).

  DB path (`app/api/internships/route.ts:106`): builds `conditions: any[]` with `eq/ilike/or/and` from drizzle-orm, including tag conditions (`app/api/internships/route.ts:131-136` `eq(isFaang, only)`). `where = and(...conditions)`. `baseWhere` same but without `applied` (for stats). Executes 3 counts in parallel: `total` (full `where`), `appliedCount`/`notAppliedCount` (baseWhere + applied). Fetches facets `selectDistinct age`, sorts via `sql` `regexp_replace(age)`, pages with `limit/offset`. Returns `{data, pagination: {page,limit,total,totalPages,hasMore}, stats: {total,applied,notApplied}, facets: {ages}, meta: {source,sort,filters: {...tagFilters}}}` (`app/api/internships/route.ts:216`). 500 on DB error.

- `PATCH /api/internships` (`app/api/internships/route.ts:307`): `{id, applied}` → `update set applied where id` → returns `{id, applied}`. 503 if no DB.

### `GET /api/top-picks` (`app/api/top-picks/route.ts:25`)

DB-only — 503 if `DATABASE_URL` missing. Returns most recent N matching user keywords (case-insensitive substring on `company/role/location`), also tag-filtered.

- Loads `topPickKeywords` from DB (`app/api/top-picks/route.ts:42`); if empty → `{data:[], keywords:[], meta:{source,limit,totalMatching:0}}`.
- DB path (`app/api/top-picks/route.ts:58`): `keywordWhere = or(...ilike patterns)`, `tagConditions` from `tagFilters` (`app/api/top-picks/route.ts:67-72`), `where = tagConditions.length ? and(keywordWhere, ...tagConditions) : keywordWhere`. Counts `totalMatching`, orders by `age` numeric asc (`sql` regexp_replace), `limit`.
- Query params: `limit` (1..24, `app/api/top-picks/route.ts:27`) + same 5 tag params as internships. Shared filtering lets Top Picks respect the same tag state as the main list.

### `api/keywords` (`app/api/keywords/route.ts:7`)

CRUD for `topPickKeywords` (all 503 if no DB). `GET` ordered asc, `POST {keyword}` checks case-insensitive uniqueness and length ≤100, `PATCH {id, keyword}`, `DELETE ?id=`. Used by the keywords manager modal in `app/page.tsx`.

## Frontend `app/page.tsx:1` (Client Component)

Single page, all state client-side, backend-paginated via `/api/*`.

- **State:** `internships, pagination, stats, facets, metaSource, isLoading` (`app/page.tsx:41-48`); query `query/queryInput` (debounced 300ms `app/page.tsx:77`), `ageFilter, appliedFilter, sort, tagFilters: Record<TagKey,TagFilter>` (`app/page.tsx:55`), `TagFilter` cycle `all→exclude→only→all` (`app/page.tsx:280`), Top Picks `keywords, topPicks, topPicksMeta` (`app/page.tsx:64-67`).
- **Fetching:** `fetchPage(page, append)` (`app/page.tsx:82`) builds `URLSearchParams` with `q/age/applied/sort` + all non-`all` tag filters (`app/page.tsx:92`), aborts prior request, expects `{data,pagination,stats}` (DB-only, 503 if no DB). `useEffect` on `fetchPage` identity (depends on `tagFilters` etc.) → auto-refetch on filter change. `fetchTopPicks` (`app/page.tsx:156`) same tag params → `/api/top-picks?limit=6&<tags>`, depends on `tagFilters`; `useEffect` on mount and on `keywords.length` (`app/page.tsx:189`).
- **Mutations:** `toggleApplied(id)` (`app/page.tsx:300`) optimistically flips `applied` in both lists, updates `stats`, PATCHes DB if available, rolls back on failure. Keywords CRUD (`app/page.tsx:196-252`) POST/PATCH/DELETE then `fetchTopPicks()`.
- **UI Sections:**
  - Sticky header (`app/page.tsx:331`): search input, `age`/`applied`/`sort` selects (`app/page.tsx:354-356`), Clear, tag filter bar (`app/page.tsx:360` `TAG_DEFS` pills cycling All/Hide/Only, `hasActiveTagFilters`). Active filter chips row (`app/page.tsx:394`).
  - Legend bar (`app/page.tsx:407`): same `TAG_DEFS` as clickable legend (shared filter, shows `● Only`/`○ Hide`).
  - Main: Top Picks section (`app/page.tsx:432` amber border, keyword chips `app/page.tsx:442`, inline tag filter bar `app/page.tsx:444` — duplicate controls for convenience, same `tagFilters` state, grid of `InternshipCard` `app/page.tsx:484`). Then main grid (`app/page.tsx:491` loading skeletons, `app/page.tsx:505` `InternshipCard` grid, Load More, pagination footer with tag summary `app/page.tsx:510`).
  - Keywords manager modal (`app/page.tsx:515`).

### `app/components/InternshipCard.tsx:1`

`Internship` type mirrors API shape (`app/components/InternshipCard.tsx:1`). Exported `TagKey` union (`app/components/InternshipCard.tsx:16`). Helpers `ageBadgeClasses` (`app/components/InternshipCard.tsx:18`) and `formatAgeLabel` (`app/components/InternshipCard.tsx:31`). `LegendBadges` (`app/components/InternshipCard.tsx:38`): builds pills only when boolean is true (no clutter when false), maps `is_faang→🔥`, `requires_advanced_degree→🎓`, `no_sponsorship→🛂`, `requires_citizenship→🇺🇸`, `is_closed→🔒` with fixed Tailwind color classes (`app/components/InternshipCard.tsx:40-44`). When `onTagClick` provided, renders `<button>` per badge (`app/components/InternshipCard.tsx:49`) that calls `onTagClick(tagKey)` (used to set filter to `only` that tag, `app/page.tsx:289` `handleCardTagClick` toggles `only`↔`all` and scrolls to top). `InternshipCard` (`app/components/InternshipCard.tsx:63`) props `{job, onToggle, showLegend=true, onTagClick}`. Card chrome varies by `is_closed` (opacity) vs `applied` (emerald) vs default. Always shows `LegendBadges` now (`app/page.tsx:484,506` no `showLegend={false}`), so Top Picks and main grid both show tags when true.

## Filtering System

Backend-filtered everywhere (no client filtering except optimistic `applied` toggle). Three filter dimensions:

- **Text** `q`: `ilike %q%` on company/role/location (DB) or `hay.includes` (JSON).
- **Facets** `age` (distinct ages sorted numerically) and `applied`.
- **Tags** (5 booleans, tri-state): `all` (no clause), `only` (`where col = true`), `exclude` (`where col = false`). Accepted values include `true/false/hide` aliases via `parseTagFilter` (`app/api/internships/route.ts:23`). For internships, tag filters enter both `where` (full) and `baseWhere` (for stats) so counts stay consistent. For top-picks, tag filters `and` with keyword `or`. UI cycles `all→exclude(Hide)→only→all` in header/legend/top-picks; card badge click sets `only` (toggling off if already `only`). Active chips show `Only` in badge colors vs `Hide` in muted strikethrough.

## Styling & Layout

Tailwind 4 (`app/globals.css:1` `@import "tailwindcss"`, CSS vars for light/dark). `app/layout.tsx:15` metadata, `Geist` fonts, `h-full` antialiased. Cards: `rounded-2xl border shadow-sm`, Top Picks: `border-amber-200 bg-amber-50/60`.

## Data Ingestion & Scripts

- `scripts/sync-internships.ts:13` — scrapes `https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md`, parses emoji flags (`🛂 🇺🇸 🔒 🔥 🎓`) + company/role/location/links, and upserts into DB (`insert` new + `update` flag/text backfill); records every run in `sync_runs` (`db/schema.ts:30`). Run via `npm run db:sync` (also seeds empty DB) or `db:sync:dry`.
- `scripts/wait-for-db.sh` + `npm run db:*` helpers in `package.json:12`.

## Docker / Deploy

- `next.config.ts:4` standalone, `Dockerfile:12` multi-stage (`deps` → `builder` `npm run build` → `runner` `node server.js` on 3000). Copies `drizzle`, `db`, `internships.json` for runtime fallback.
- `docker-compose.yml:1` `db` (postgres:16-alpine, healthcheck `pg_isready`), `app` depends on `db` healthy, `DATABASE_URL` points to `db:5432`.
- `drizzle.config.ts:7` `DATABASE_URL` fallback to localhost:5432.

## Development Workflows

```bash
cp .env.example .env
npm install
npm run dev                         # requires Postgres
npm run db:setup                    # up + wait + migrate + sync (seeds via sync)
npm run dev:db                      # setup + dev
npm run docker:up / docker:down
npm run db:migrate / db:push / db:studio / db:sync -- --dry-run
```

`GET /api/internships` without params still returns full array for simple fetches; paginated JSON uses `?page&limit&q&age&applied&sort&is_faang&...`.

## Conventions for Agents

- This file’s `nextjs-agent-rules` block is auto-managed by `next dev` (`node_modules/next/dist/server/lib/generate-agent-files.js`). Do not remove; append docs below it.
- Prefer backend filtering (add SQL `where` + JSON `matchesTags`) over client filtering; keep `meta.filters` in sync.
- Keep `TAG_DEFS` (`app/page.tsx:32`, `app/components/InternshipCard.tsx:38`) single source of truth for label/icon/color; `TagKey` is the wire name (snake_case) used in query strings and DB column mapping.
- When adding new filter dimensions, extend `hasPaginationParams` (`app/api/internships/route.ts:34`) and `TAG_DEFS` + `parseTagFilter` + frontend state.
