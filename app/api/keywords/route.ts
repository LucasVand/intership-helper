import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { topPickKeywords } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const rows = await db.select().from(topPickKeywords).orderBy(asc(topPickKeywords.keyword));
    return NextResponse.json(rows);
  } catch (e) {
    console.error("GET /api/keywords failed:", e);
    return NextResponse.json({ error: "Failed to fetch keywords" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const body = await req.json();
    const raw = String(body.keyword ?? "").trim();
    if (!raw) return NextResponse.json({ error: "keyword required" }, { status: 400 });
    if (raw.length > 100) return NextResponse.json({ error: "keyword too long (max 100)" }, { status: 400 });

    // case-insensitive uniqueness: check lower
    const existing = await db.select().from(topPickKeywords);
    if (existing.some((r) => r.keyword.toLowerCase() === raw.toLowerCase())) {
      return NextResponse.json({ error: "keyword already exists" }, { status: 409 });
    }

    const [inserted] = await db.insert(topPickKeywords).values({ keyword: raw }).returning();
    return NextResponse.json(inserted, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? e).includes("unique") || String(e?.code) === "23505") {
      return NextResponse.json({ error: "keyword already exists" }, { status: 409 });
    }
    console.error("POST /api/keywords failed:", e);
    return NextResponse.json({ error: "Failed to create keyword" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const body = await req.json();
    const id = Number(body.id);
    const raw = String(body.keyword ?? "").trim();
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!raw) return NextResponse.json({ error: "keyword required" }, { status: 400 });
    if (raw.length > 100) return NextResponse.json({ error: "keyword too long" }, { status: 400 });

    const existing = await db.select().from(topPickKeywords);
    if (existing.some((r) => r.id !== id && r.keyword.toLowerCase() === raw.toLowerCase())) {
      return NextResponse.json({ error: "keyword already exists" }, { status: 409 });
    }

    const [updated] = await db.update(topPickKeywords).set({ keyword: raw }).where(eq(topPickKeywords.id, id)).returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("PATCH /api/keywords failed:", e);
    return NextResponse.json({ error: "Failed to update keyword" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    let id = Number(idParam);
    // also allow body {id}
    if (!id || Number.isNaN(id)) {
      try {
        const body = await req.json();
        id = Number(body.id);
      } catch {}
    }
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    const [deleted] = await db.delete(topPickKeywords).where(eq(topPickKeywords.id, id)).returning();
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (e) {
    console.error("DELETE /api/keywords failed:", e);
    return NextResponse.json({ error: "Failed to delete keyword" }, { status: 500 });
  }
}
