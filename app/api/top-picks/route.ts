import { NextResponse } from "next/server";
import { or, ilike, sql, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { internships, topPickKeywords } from "@/db/schema";
import internshipsData from "@/internships.json";

type TagFilter = "all" | "only" | "exclude";
function parseTagFilter(v: string | null): TagFilter {
  if (!v) return "all";
  const s = v.toLowerCase();
  if (s === "only" || s === "true" || s === "1") return "only";
  if (s === "exclude" || s === "hide" || s === "false" || s === "0") return "exclude";
  return "all";
}

export const dynamic = "force-dynamic";

function parseAgeDays(age?: string | null): number {
  if (!age) return 999;
  const m = age.match(/(\d+)/);
  if (!m) return 999;
  return parseInt(m[1], 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = parseInt(searchParams.get("limit") || "6", 10) || 6;
  const limit = Math.min(24, Math.max(1, limitRaw));
  const tagFilters = {
    is_faang: parseTagFilter(searchParams.get("is_faang")),
    is_closed: parseTagFilter(searchParams.get("is_closed")),
    no_sponsorship: parseTagFilter(searchParams.get("no_sponsorship")),
    requires_citizenship: parseTagFilter(searchParams.get("requires_citizenship")),
    requires_advanced_degree: parseTagFilter(searchParams.get("requires_advanced_degree")),
  };

  // Load keywords from DB (global)
  let keywords: string[] = [];
  let source: "db" | "json" = "json";
  if (db) {
    try {
      const rows = await db.select().from(topPickKeywords);
      keywords = rows.map((r) => r.keyword).filter(Boolean);
      source = "db";
    } catch (e) {
      console.error("top-picks keyword fetch failed:", e);
    }
  }

  if (keywords.length === 0) {
    return NextResponse.json({
      data: [],
      keywords,
      meta: { source, limit, totalMatching: 0 },
    });
  }

  // DB path: filter internships where company/role/location ILIKE any keyword AND tag filters, sorted by most recent (age numeric asc)
  if (db) {
    try {
      const conditions = keywords.flatMap((kw) => {
        const pattern = `%${kw}%`;
        return [ilike(internships.company, pattern), ilike(internships.role, pattern), ilike(internships.location, pattern)];
      });

      const keywordWhere = or(...conditions);
      const tagConditions: any[] = [];
      if (tagFilters.is_faang !== "all") tagConditions.push(eq(internships.isFaang, tagFilters.is_faang === "only"));
      if (tagFilters.is_closed !== "all") tagConditions.push(eq(internships.isClosed, tagFilters.is_closed === "only"));
      if (tagFilters.no_sponsorship !== "all") tagConditions.push(eq(internships.noSponsorship, tagFilters.no_sponsorship === "only"));
      if (tagFilters.requires_citizenship !== "all") tagConditions.push(eq(internships.requiresCitizenship, tagFilters.requires_citizenship === "only"));
      if (tagFilters.requires_advanced_degree !== "all") tagConditions.push(eq(internships.requiresAdvancedDegree, tagFilters.requires_advanced_degree === "only"));
      const where = tagConditions.length ? and(keywordWhere!, ...tagConditions) : keywordWhere;

      // Count total matching for meta
      const { count } = await import("drizzle-orm");
      const totalRes = await db.select({ value: count() }).from(internships).where(where);
      const totalMatching = Number(totalRes[0]?.value ?? 0);

      const orderBy = sql`CAST(NULLIF(regexp_replace(${internships.age}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, ${internships.id} ASC`;

      const rows = await db.select().from(internships).where(where).orderBy(orderBy).limit(limit);

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

      return NextResponse.json({
        data,
        keywords,
        meta: { source: "db" as const, limit, totalMatching, filters: tagFilters },
      });
    } catch (e) {
      console.error("top-picks DB query failed, falling back to JSON:", e);
    }
  }

  // JSON fallback
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

  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const filtered = all.filter((item) => {
    const hay = `${item.company} ${item.role} ${item.location}`.toLowerCase();
    if (!lowerKeywords.some((kw) => hay.includes(kw))) return false;
    if (!matchesTags(item)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => parseAgeDays(a.age) - parseAgeDays(b.age));
  const data = sorted.slice(0, limit);

  return NextResponse.json({
    data,
    keywords,
    meta: { source: "json" as const, limit, totalMatching: filtered.length, filters: tagFilters },
  });
}
