import { NextResponse } from "next/server";
import { db } from "@/db";
import { getDatabaseUrl, runSync } from "@/scripts/sync-core";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured — set DATABASE_URL and run npm run db:setup" }, { status: 503 });
  }

  let dryRun = false;
  try {
    const url = new URL(req.url);
    const qDry = url.searchParams.get("dryRun") || url.searchParams.get("dry_run");
    if (qDry === "true" || qDry === "1") dryRun = true;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.clone().json().catch(() => ({}));
      if (body && (body.dryRun === true || body.dry_run === true)) dryRun = true;
    }
  } catch {}

  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    return NextResponse.json({ error: "Database not configured — set DATABASE_URL" }, { status: 503 });
  }

  try {
    // single function call — all sync logic lives in scripts/sync-core.ts
    const result = await runSync({ dbUrl, dryRun, logFilePath: null });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("POST /api/sync failed:", e);
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 500) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // GET as dryRun convenience
  const url = new URL(req.url);
  const isDry = url.searchParams.get("dryRun") !== "false";
  return POST(new Request(`${url.origin}/api/sync?dryRun=${isDry ? "true" : "false"}`, { method: "POST" }));
}
