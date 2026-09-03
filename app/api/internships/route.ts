import { NextResponse } from "next/server";
import { eq, ilike, and, or, asc, desc, sql, count } from "drizzle-orm";
import { db } from "@/db";
import { internships } from "@/db/schema";

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
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured — set DATABASE_URL and run npm run db:setup" },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
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

  try {
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
    if (tagFilters.is_faang !== "all") conditions.push(eq(internships.isFaang, tagFilters.is_faang === "only"));
    if (tagFilters.is_closed !== "all") conditions.push(eq(internships.isClosed, tagFilters.is_closed === "only"));
    if (tagFilters.no_sponsorship !== "all") conditions.push(eq(internships.noSponsorship, tagFilters.no_sponsorship === "only"));
    if (tagFilters.requires_citizenship !== "all") conditions.push(eq(internships.requiresCitizenship, tagFilters.requires_citizenship === "only"));
    if (tagFilters.requires_advanced_degree !== "all") conditions.push(eq(internships.requiresAdvancedDegree, tagFilters.requires_advanced_degree === "only"));

    const where = conditions.length ? and(...conditions) : undefined;

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

    const totalRes = await db.select({ value: count() }).from(internships).where(where);
    const total = Number(totalRes[0]?.value ?? 0);

    const appliedWhere = baseWhere ? and(baseWhere, eq(internships.applied, true)) : eq(internships.applied, true);
    const notAppliedWhere = baseWhere ? and(baseWhere, eq(internships.applied, false)) : eq(internships.applied, false);
    const [appliedRes, notAppliedRes] = await Promise.all([
      db.select({ value: count() }).from(internships).where(appliedWhere),
      db.select({ value: count() }).from(internships).where(notAppliedWhere),
    ]);
    const appliedCount = Number(appliedRes[0]?.value ?? 0);
    const notAppliedCount = Number(notAppliedRes[0]?.value ?? 0);

    const ageRows = await db.selectDistinct({ age: internships.age }).from(internships);
    const ages = ageRows
      .map((r) => r.age)
      .filter((a): a is string => Boolean(a))
      .sort((a, b) => parseAgeDays(a) - parseAgeDays(b));

    let orderBy: any;
    if (sort === "company") orderBy = asc(internships.company);
    else if (sort === "role") orderBy = asc(internships.role);
    else if (sort === "oldest")
      orderBy = sql`CAST(NULLIF(regexp_replace(${internships.age}, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST, ${internships.id} ASC`;
    else orderBy = sql`CAST(NULLIF(regexp_replace(${internships.age}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, ${internships.id} ASC`;

    const rows = await db.select().from(internships).where(where).orderBy(orderBy).limit(limit).offset(offset);

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
    console.error("GET /api/internships failed:", e);
    return NextResponse.json({ error: "Failed to fetch internships — database may not be set up. Run npm run db:setup." }, { status: 500 });
  }
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
    const [updated] = await db.update(internships).set({ applied }).where(eq(internships.id, id)).returning();
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
