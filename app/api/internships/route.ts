import { NextResponse } from "next/server";
import { eq, ilike, and, or, asc, desc, sql, count, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { internships } from "@/db/schema";

export const dynamic = "force-dynamic";

type SortKey = "newest" | "oldest" | "company" | "role";

function formatAge(postedAt?: Date | null): string | undefined {
  if (!postedAt) return undefined;
  const minutes = Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 30 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return `${Math.floor(minutes / (30 * 24 * 60))}mo`;
}

function ageFilterCondition(age: string) {
  const match = age.match(/^(\d+)(d|mo)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const days = match[2] === "mo" ? value * 30 : value;
  const newerThan = new Date(Date.now() - (days + (match[2] === "mo" ? 30 : 1)) * 24 * 60 * 60 * 1000);
  const olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return and(gte(internships.postedAt, newerThan), lt(internships.postedAt, olderThan));
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
  const dislikedFilter = searchParams.get("disliked") || "not_disliked";
  const includeDisliked = searchParams.get("include_disliked") === "true";
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
      const ageCondition = ageFilterCondition(ageFilter);
      if (ageCondition) conditions.push(ageCondition);
    }
    if (appliedFilter === "applied") {
      conditions.push(eq(internships.applied, true));
    } else if (appliedFilter === "not_applied") {
      conditions.push(eq(internships.applied, false));
    }
    if (dislikedFilter === "disliked") conditions.push(eq(internships.disliked, true));
    else if (!includeDisliked && dislikedFilter !== "all") conditions.push(eq(internships.disliked, false));
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
    if (ageFilter !== "all") {
      const ageCondition = ageFilterCondition(ageFilter);
      if (ageCondition) baseConditions.push(ageCondition);
    }
    if (dislikedFilter === "disliked") baseConditions.push(eq(internships.disliked, true));
    else if (!includeDisliked && dislikedFilter !== "all") baseConditions.push(eq(internships.disliked, false));
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
    const dislikedWhere = eq(internships.disliked, true);
    const [appliedRes, notAppliedRes, dislikedRes] = await Promise.all([
      db.select({ value: count() }).from(internships).where(appliedWhere),
      db.select({ value: count() }).from(internships).where(notAppliedWhere),
      db.select({ value: count() }).from(internships).where(dislikedWhere),
    ]);
    const appliedCount = Number(appliedRes[0]?.value ?? 0);
    const notAppliedCount = Number(notAppliedRes[0]?.value ?? 0);
    const dislikedCount = Number(dislikedRes[0]?.value ?? 0);

    const ages = ["0d", "1d", "2d", "3d", "7d", "14d", "30d"];

    let orderBy: any;
    if (sort === "company") orderBy = asc(internships.company);
    else if (sort === "role") orderBy = asc(internships.role);
    else if (sort === "oldest")
      orderBy = sql`${internships.postedAt} ASC NULLS LAST, ${internships.id} ASC`;
    else orderBy = sql`${internships.postedAt} DESC NULLS LAST, ${internships.id} ASC`;

    const rows = await db.select().from(internships).where(where).orderBy(orderBy).limit(limit).offset(offset);

    const data = rows.map((r) => ({
      id: r.id,
      company: r.company,
      role: r.role,
      location: r.location,
      application_link: r.applicationLink,
      source: r.source,
      age: formatAge(r.postedAt),
      posted_at: r.postedAt?.toISOString(),
      applied: r.applied,
      disliked: r.disliked,
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
      stats: { total, applied: appliedCount, notApplied: notAppliedCount, disliked: dislikedCount },
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
    const hasApplied = typeof body.applied === "boolean";
    const hasDisliked = typeof body.disliked === "boolean";
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
    }
    if (!hasApplied && !hasDisliked) {
      return NextResponse.json({ error: "No supported field to update" }, { status: 400 });
    }
    const [updated] = await db
      .update(internships)
      .set({
        ...(hasApplied ? { applied: body.applied } : {}),
        ...(hasDisliked ? { disliked: body.disliked } : {}),
      })
      .where(eq(internships.id, id))
      .returning();
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: updated.id,
      applied: updated.applied,
      disliked: updated.disliked,
    });
  } catch (e) {
    console.error("PATCH /api/internships failed:", e);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const company = typeof body.company === "string" ? body.company.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const applicationLink = typeof body.applicationLink === "string" ? body.applicationLink.trim() : "";

    if (!company || !role || !location || !applicationLink) {
      return NextResponse.json({ error: "Company, role, location, and application link are required" }, { status: 400 });
    }

    try {
      const parsedLink = new URL(applicationLink);
      if (parsedLink.protocol !== "http:" && parsedLink.protocol !== "https:") {
        return NextResponse.json({ error: "Application link must use http or https" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Application link must be a valid URL" }, { status: 400 });
    }

    const [created] = await db
      .insert(internships)
      .values({
        company,
        role,
        location,
        applicationLink,
        source: "manual",
        postedAt: new Date(),
        applied: true,
      })
      .returning();

    return NextResponse.json({
      id: created.id,
      company: created.company,
      role: created.role,
      location: created.location,
      application_link: created.applicationLink,
      source: created.source,
      age: "0m",
      posted_at: created.postedAt?.toISOString(),
      applied: created.applied,
      disliked: created.disliked,
    }, { status: 201 });
  } catch (e: unknown) {
    console.error("POST /api/internships failed:", e);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "An internship with this application link already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create internship" }, { status: 500 });
  }
}
