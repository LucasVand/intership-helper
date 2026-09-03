import { NextResponse } from "next/server";
import { eq, ilike, and, or, asc, desc, sql, count } from "drizzle-orm";
import { db } from "@/db";
import { internships } from "@/db/schema";
import internshipsData from "@/internships.json";

export const dynamic = "force-dynamic";

type SortKey = "newest" | "oldest" | "company" | "role";

function parseAgeDays(age?: string | null): number {
  if (!age) return 999;
  const m = age.match(/(\d+)/);
  if (!m) return 999;
  return parseInt(m[1], 10);
}

function toSortOrder(sort: string): SortKey {
  if (sort === "oldest" || sort === "company" || sort === "role") return sort as SortKey;
  return "newest";
}

type TagFilter = "all" | "only" | "exclude";
function parseTagFilter(v: string | null): TagFilter {
  if (!v) return "all";
  const s = v.toLowerCase();
  if (s === "only" || s === "true" || s === "1") return "only";
  if (s === "exclude" || s === "hide" || s === "false" || s === "0") return "exclude";
  return "all";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hasPaginationParams =
    searchParams.has("page") ||
    searchParams.has("limit") ||
    searchParams.has("q") ||
    searchParams.has("age") ||
    searchParams.has("applied") ||
    searchParams.has("sort") ||
    searchParams.has("is_faang") ||
    searchParams.has("is_closed") ||
    searchParams.has("no_sponsorship") ||
    searchParams.has("requires_citizenship") ||
    searchParams.has("requires_advanced_degree");

  // Legacy mode: no query params -> return full array (backward compat for simple fetch)
  if (!hasPaginationParams) {
    if (db) {
      try {
        const rows = await db.select().from(internships);
        const mapped = rows.map((r) => ({
          id: r.id,
          company: r.company,
          role: r.role,
          location: r.location,
          application_links: r.applicationLinks,
          age: r.age ?? undefined,
          applied: r.applied,
          no_sponsorship: r.noSponsorship,
          requires_citizenship: r.requiresCitizenship,
          is_closed: r.isClosed,
          is_faang: r.isFaang,
          requires_advanced_degree: r.requiresAdvancedDegree,
        }));
        return NextResponse.json(mapped);
      } catch (e) {
        console.error("DB query failed, falling back to JSON:", e);
      }
    }
    const fallback = internshipsData.map((row: any, idx: number) => ({
      id: idx + 1,
      company: row.company,
      role: row.role,
      location: row.location,
      application_links: row.application_links,
      age: row.age,
      applied: false,
      no_sponsorship: Boolean(row.no_sponsorship),
      requires_citizenship: Boolean(row.requires_citizenship),
      is_closed: Boolean(row.is_closed),
      is_faang: Boolean(row.is_faang),
      requires_advanced_degree: Boolean(row.requires_advanced_degree),
    }));
    return NextResponse.json(fallback);
  }

  // Paginated mode
  const q = (searchParams.get("q") || "").trim();
  const ageFilter = searchParams.get("age") || "all";
  const appliedFilter = searchParams.get("applied") || "all"; // all | applied | not_applied
  const sort = toSortOrder(searchParams.get("sort") || "newest");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limitRaw = parseInt(searchParams.get("limit") || "48", 10) || 48;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;
  const tagFilters = {
    is_faang: parseTagFilter(searchParams.get("is_faang")),
    is_closed: parseTagFilter(searchParams.get("is_closed")),
    no_sponsorship: parseTagFilter(searchParams.get("no_sponsorship")),
    requires_citizenship: parseTagFilter(searchParams.get("requires_citizenship")),
    requires_advanced_degree: parseTagFilter(searchParams.get("requires_advanced_degree")),
  };

  // Try DB path first
  if (db) {
    try {
      // Build where conditions
      const whereClauses: ReturnType<typeof eq>[] = [];
      // We'll build arrays of conditions for and()
      const conditions: any[] = [];

      if (ageFilter !== "all") {
        conditions.push(eq(internships.age, ageFilter));
      }
      if (appliedFilter === "applied") {
        conditions.push(eq(internships.applied, true));
      } else if (appliedFilter === "not_applied") {
        conditions.push(eq(internships.applied, false));
      }
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            ilike(internships.company, pattern),
            ilike(internships.role, pattern),
            ilike(internships.location, pattern)
          )!
        );
      }
      // Tag filters (shared for where and baseWhere)
      if (tagFilters.is_faang !== "all") conditions.push(eq(internships.isFaang, tagFilters.is_faang === "only"));
      if (tagFilters.is_closed !== "all") conditions.push(eq(internships.isClosed, tagFilters.is_closed === "only"));
      if (tagFilters.no_sponsorship !== "all") conditions.push(eq(internships.noSponsorship, tagFilters.no_sponsorship === "only"));
      if (tagFilters.requires_citizenship !== "all") conditions.push(eq(internships.requiresCitizenship, tagFilters.requires_citizenship === "only"));
      if (tagFilters.requires_advanced_degree !== "all") conditions.push(eq(internships.requiresAdvancedDegree, tagFilters.requires_advanced_degree === "only"));

      const where = conditions.length ? and(...conditions) : undefined;

      // Base conditions without applied (for stats) — includes q, age, and tags but not applied
      const baseConditions: any[] = [];
      if (ageFilter !== "all") baseConditions.push(eq(internships.age, ageFilter));
      if (q) {
        const pattern = `%${q}%`;
        baseConditions.push(
          or(
            ilike(internships.company, pattern),
            ilike(internships.role, pattern),
            ilike(internships.location, pattern)
          )!
        );
      }
      if (tagFilters.is_faang !== "all") baseConditions.push(eq(internships.isFaang, tagFilters.is_faang === "only"));
      if (tagFilters.is_closed !== "all") baseConditions.push(eq(internships.isClosed, tagFilters.is_closed === "only"));
      if (tagFilters.no_sponsorship !== "all") baseConditions.push(eq(internships.noSponsorship, tagFilters.no_sponsorship === "only"));
      if (tagFilters.requires_citizenship !== "all") baseConditions.push(eq(internships.requiresCitizenship, tagFilters.requires_citizenship === "only"));
      if (tagFilters.requires_advanced_degree !== "all") baseConditions.push(eq(internships.requiresAdvancedDegree, tagFilters.requires_advanced_degree === "only"));
      const baseWhere = baseConditions.length ? and(...baseConditions) : undefined;

      // Total count with full filters
      const totalRes = await db.select({ value: count() }).from(internships).where(where);
      const total = Number(totalRes[0]?.value ?? 0);

      // Stats for applied / not_applied within base filter
      const appliedWhere = baseWhere ? and(baseWhere, eq(internships.applied, true)) : eq(internships.applied, true);
      const notAppliedWhere = baseWhere ? and(baseWhere, eq(internships.applied, false)) : eq(internships.applied, false);
      const [appliedRes, notAppliedRes] = await Promise.all([
        db.select({ value: count() }).from(internships).where(appliedWhere),
        db.select({ value: count() }).from(internships).where(notAppliedWhere),
      ]);
      const appliedCount = Number(appliedRes[0]?.value ?? 0);
      const notAppliedCount = Number(notAppliedRes[0]?.value ?? 0);

      // Facets: distinct ages
      const ageRows = await db.selectDistinct({ age: internships.age }).from(internships);
      const ages = ageRows
        .map((r) => r.age)
        .filter((a): a is string => Boolean(a))
        .sort((a, b) => parseAgeDays(a) - parseAgeDays(b));

      // Sorting
      let orderBy: any;
      if (sort === "company") orderBy = asc(internships.company);
      else if (sort === "role") orderBy = asc(internships.role);
      else if (sort === "oldest")
        orderBy = sql`CAST(NULLIF(regexp_replace(${internships.age}, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST, ${internships.id} ASC`;
      else
        orderBy = sql`CAST(NULLIF(regexp_replace(${internships.age}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, ${internships.id} ASC`;

      const rows = await db
        .select()
        .from(internships)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const data = rows.map((r) => ({
        id: r.id,
        company: r.company,
        role: r.role,
        location: r.location,
        application_links: r.applicationLinks,
        age: r.age ?? undefined,
        applied: r.applied,
        no_sponsorship: r.noSponsorship,
        requires_citizenship: r.requiresCitizenship,
        is_closed: r.isClosed,
        is_faang: r.isFaang,
        requires_advanced_degree: r.requiresAdvancedDegree,
      }));

      const totalPages = Math.max(1, Math.ceil(total / limit));
      const hasMore = page < totalPages;

      return NextResponse.json({
        data,
        pagination: { page, limit, total, totalPages, hasMore },
        stats: { total, applied: appliedCount, notApplied: notAppliedCount },
        facets: { ages },
        meta: { source: "db" as const, sort, filters: { q, age: ageFilter, applied: appliedFilter, ...tagFilters } },
      });
    } catch (e) {
      console.error("DB paginated query failed, falling back to JSON:", e);
      // fall through to JSON fallback
    }
  }

  // JSON fallback with same pagination/filter/sort logic in-memory
  const all = internshipsData.map((row: any, idx: number) => ({
    id: idx + 1,
    company: row.company,
    role: row.role,
    location: row.location,
    application_links: row.application_links,
    age: row.age as string | undefined,
    applied: false as boolean,
    no_sponsorship: Boolean(row.no_sponsorship),
    requires_citizenship: Boolean(row.requires_citizenship),
    is_closed: Boolean(row.is_closed),
    is_faang: Boolean(row.is_faang),
    requires_advanced_degree: Boolean(row.requires_advanced_degree),
  }));

  // For facets, distinct ages from all
  const ageSet = new Set<string>();
  all.forEach((r) => {
    if (r.age) ageSet.add(r.age);
  });
  const facetsAges = Array.from(ageSet).sort((a, b) => parseAgeDays(a) - parseAgeDays(b));

  function matchesTags(item: typeof all[number]): boolean {
    if (tagFilters.is_faang === "only" && !item.is_faang) return false;
    if (tagFilters.is_faang === "exclude" && item.is_faang) return false;
    if (tagFilters.is_closed === "only" && !item.is_closed) return false;
    if (tagFilters.is_closed === "exclude" && item.is_closed) return false;
    if (tagFilters.no_sponsorship === "only" && !item.no_sponsorship) return false;
    if (tagFilters.no_sponsorship === "exclude" && item.no_sponsorship) return false;
    if (tagFilters.requires_citizenship === "only" && !item.requires_citizenship) return false;
    if (tagFilters.requires_citizenship === "exclude" && item.requires_citizenship) return false;
    if (tagFilters.requires_advanced_degree === "only" && !item.requires_advanced_degree) return false;
    if (tagFilters.requires_advanced_degree === "exclude" && item.requires_advanced_degree) return false;
    return true;
  }
  // Filter base (without applied) for stats
  const baseFiltered = all.filter((item) => {
    if (ageFilter !== "all" && item.age !== ageFilter) return false;
    if (!matchesTags(item)) return false;
    if (!q) return true;
    const hay = `${item.company} ${item.role} ${item.location}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const appliedCount = baseFiltered.filter((i) => i.applied).length;
  const notAppliedCount = baseFiltered.filter((i) => !i.applied).length;

  // Full filtered
  let filtered = baseFiltered.filter((item) => {
    if (appliedFilter === "applied" && !item.applied) return false;
    if (appliedFilter === "not_applied" && item.applied) return false;
    return true;
  });

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sort === "newest") return parseAgeDays(a.age) - parseAgeDays(b.age);
    if (sort === "oldest") return parseAgeDays(b.age) - parseAgeDays(a.age);
    if (sort === "company") return a.company.localeCompare(b.company);
    if (sort === "role") return a.role.localeCompare(b.role);
    return 0;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;
  const data = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages, hasMore },
    stats: { total, applied: appliedCount, notApplied: notAppliedCount },
    facets: { ages: facetsAges },
    meta: { source: "json" as const, sort, filters: { q, age: ageFilter, applied: appliedFilter, ...tagFilters } },
  });
}

export async function PATCH(req: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  try {
    const body = await req.json();
    const id = Number(body.id);
    const applied = Boolean(body.applied);
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
    }
    const [updated] = await db
      .update(internships)
      .set({ applied })
      .where(eq(internships.id, id))
      .returning();
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: updated.id,
      applied: updated.applied,
    });
  } catch (e) {
    console.error("PATCH /api/internships failed:", e);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
