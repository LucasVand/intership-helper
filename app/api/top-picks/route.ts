import { NextResponse } from "next/server";
import { or, ilike, sql, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { internships, topPickKeywords } from "@/db/schema";

type TagFilter = "all" | "only" | "exclude";
function parseTagFilter(v: string | null): TagFilter {
  if (!v) return "all";
  const s = v.toLowerCase();
  if (s === "only" || s === "true" || s === "1") return "only";
  if (s === "exclude" || s === "hide" || s === "false" || s === "0") return "exclude";
  return "all";
}

export const dynamic = "force-dynamic";

function formatAge(postedAt?: Date | null): string | undefined {
  if (!postedAt) return undefined;
  const minutes = Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 30 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return `${Math.floor(minutes / (30 * 24 * 60))}mo`;
}

export async function GET(req: Request) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured — set DATABASE_URL and run npm run db:setup" },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const limitRaw = parseInt(searchParams.get("limit") || "6", 10) || 6;
  const limit = Math.min(24, Math.max(1, limitRaw));
  const excludeApplied = searchParams.get("exclude_applied") !== "false";
  const includeDisliked = searchParams.get("include_disliked") === "true";
  const tagFilters = {
    is_faang: parseTagFilter(searchParams.get("is_faang")),
    is_closed: parseTagFilter(searchParams.get("is_closed")),
    no_sponsorship: parseTagFilter(searchParams.get("no_sponsorship")),
    requires_citizenship: parseTagFilter(searchParams.get("requires_citizenship")),
    requires_advanced_degree: parseTagFilter(searchParams.get("requires_advanced_degree")),
  };

  let keywords: string[] = [];
  try {
    const rows = await db.select().from(topPickKeywords);
    keywords = rows.map((r) => r.keyword).filter(Boolean);
  } catch (e) {
    console.error("top-picks keyword fetch failed:", e);
    return NextResponse.json({ error: "Failed to fetch keywords — database may not be set up. Run npm run db:setup." }, { status: 500 });
  }

  if (keywords.length === 0) {
    return NextResponse.json({
      data: [],
      keywords,
      meta: { source: "db" as const, limit, totalMatching: 0, excludeApplied, includeDisliked, filters: tagFilters },
    });
  }

  try {
    const conditions = keywords.flatMap((kw) => {
      const pattern = `%${kw}%`;
      return [ilike(internships.company, pattern), ilike(internships.role, pattern), ilike(internships.location, pattern)];
    });

    const keywordWhere = or(...conditions);
    const tagConditions: any[] = [];
    if (!includeDisliked) tagConditions.push(eq(internships.disliked, false));
    if (excludeApplied) tagConditions.push(eq(internships.applied, false));
    if (tagFilters.is_faang !== "all") tagConditions.push(eq(internships.isFaang, tagFilters.is_faang === "only"));
    if (tagFilters.is_closed !== "all") tagConditions.push(eq(internships.isClosed, tagFilters.is_closed === "only"));
    if (tagFilters.no_sponsorship !== "all") tagConditions.push(eq(internships.noSponsorship, tagFilters.no_sponsorship === "only"));
    if (tagFilters.requires_citizenship !== "all") tagConditions.push(eq(internships.requiresCitizenship, tagFilters.requires_citizenship === "only"));
    if (tagFilters.requires_advanced_degree !== "all") tagConditions.push(eq(internships.requiresAdvancedDegree, tagFilters.requires_advanced_degree === "only"));
    const where = tagConditions.length ? and(keywordWhere!, ...tagConditions) : keywordWhere;

    const { count } = await import("drizzle-orm");
    const totalRes = await db.select({ value: count() }).from(internships).where(where);
    const totalMatching = Number(totalRes[0]?.value ?? 0);

    const orderBy = sql`${internships.postedAt} DESC NULLS LAST, ${internships.id} ASC`;

    const rows = await db.select().from(internships).where(where).orderBy(orderBy).limit(limit);

    const data = rows.map((r) => ({
      id: r.id,
      company: r.company,
      role: r.role,
      location: r.location,
      application_links: r.applicationLinks,
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

    return NextResponse.json({
      data,
      keywords,
      meta: { source: "db" as const, limit, totalMatching, excludeApplied, includeDisliked, filters: tagFilters },
    });
  } catch (e) {
    console.error("top-picks DB query failed:", e);
    return NextResponse.json({ error: "Failed to fetch top picks — database may not be set up. Run npm run db:setup." }, { status: 500 });
  }
}
