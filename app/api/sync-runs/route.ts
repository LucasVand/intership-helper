import { NextResponse } from "next/server";
import { desc, count } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limitRaw = parseInt(searchParams.get("limit") || "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;

  try {
    const totalRes = await db.select({ value: count() }).from(syncRuns);
    const total = Number(totalRes[0]?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasMore = page < totalPages;

    const rows = await db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data: rows,
      pagination: { page, limit, total, totalPages, hasMore },
      meta: { source: "db" as const },
    });
  } catch (e: any) {
    console.error("GET /api/sync-runs failed:", e);
    // table may not exist if migration not run
    if (String(e?.message ?? "").includes("does not exist") || String(e?.code) === "42P01") {
      return NextResponse.json({ error: "sync_runs table not found — run `npm run db:migrate`" }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to fetch sync runs" }, { status: 500 });
  }
}
