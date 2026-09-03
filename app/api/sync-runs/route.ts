import { NextResponse } from "next/server";
import { desc, count } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!db) {
    return NextResponse.json(
      {
        error:
          "Database not configured — sync history requires Postgres. Set DATABASE_URL in .env (e.g. postgresql://postgres:postgres@localhost:5432/intership-helper) and run npm run db:setup (or docker compose up -d db && npm run db:migrate). No database connection was available to read sync_runs.",
      },
      { status: 503 }
    );
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
      return NextResponse.json(
        {
          error:
            "Database not set up — sync_runs table not found. Run npm run db:migrate (or npm run db:setup) to create the Postgres tables, then re-run the sync script. The database is reachable but the sync history table has not been created yet.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: `Failed to fetch sync runs — database may not be set up or not reachable. Check DATABASE_URL and run npm run db:setup. Details: ${String(e?.message ?? e).slice(0, 300)}`,
      },
      { status: 500 }
    );
  }
}
