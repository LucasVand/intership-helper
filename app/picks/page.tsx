"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InternshipCard, type Internship, type TagKey } from "../components/InternshipCard";
import { SiteNav } from "../components/SiteNav";

type Keyword = { id: number; keyword: string };
type TagFilter = "all" | "only" | "exclude";
const keys: TagKey[] = ["is_faang", "is_closed", "no_sponsorship", "requires_citizenship", "requires_advanced_degree"];
const labels: Record<TagKey, string> = { is_faang: "FAANG+", is_closed: "Closed", no_sponsorship: "No sponsorship", requires_citizenship: "U.S. Citizenship", requires_advanced_degree: "Advanced degree" };

export default function PicksPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [picks, setPicks] = useState<Internship[]>([]);
  const [filters, setFilters] = useState<Record<TagKey, TagFilter>>({ is_faang: "all", is_closed: "all", no_sponsorship: "all", requires_citizenship: "all", requires_advanced_degree: "all" });
  const [excludeApplied, setExcludeApplied] = useState(true);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams({ limit: "24" });
    if (!excludeApplied) params.set("exclude_applied", "false");
    keys.forEach((key) => filters[key] !== "all" && params.set(key, filters[key]));
    const [keywordRes, picksRes] = await Promise.all([fetch("/api/keywords"), fetch(`/api/top-picks?${params}`)]);
    if (keywordRes.ok) setKeywords(await keywordRes.json());
    if (picksRes.ok) setPicks((await picksRes.json()).data);
    setBusy(false);
  }, [excludeApplied, filters]);

  useEffect(() => { load(); }, [load]);
  const toggle = async (id: number) => {
    const current = picks.find((pick) => pick.id === id);
    if (!current) return;
    const applied = !current.applied;
    setPicks((prev) => prev.filter((pick) => !(applied && pick.id === id)).map((pick) => pick.id === id ? { ...pick, applied } : pick));
    const res = await fetch("/api/internships", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, applied }) });
    if (!res.ok) load();
  };
  const dislike = async (id: number) => {
    setPicks((prev) => prev.filter((pick) => pick.id !== id));
    const res = await fetch("/api/internships", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, disliked: true }) });
    if (!res.ok) load();
  };
  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <SiteNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-amber-200 bg-amber-50/70 p-6 dark:border-amber-800 dark:bg-amber-950/20">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">★ Top Picks</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">The newest internships matching your saved keywords.</p>
          <div className="mt-4 flex flex-wrap gap-2">{keywords.map((keyword) => <span key={keyword.id} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs dark:border-amber-800 dark:bg-zinc-900">{keyword.keyword}</span>)}{!keywords.length && <Link href="/" className="text-xs underline">Add keywords from the listings page</Link>}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {keys.map((key) => <button key={key} onClick={() => setFilters((prev) => ({ ...prev, [key]: prev[key] === "all" ? "exclude" : prev[key] === "exclude" ? "only" : "all" }))} className={`rounded-full border px-3 py-1.5 text-xs ${filters[key] === "only" ? "bg-zinc-900 text-white" : filters[key] === "exclude" ? "line-through text-zinc-500" : "bg-white dark:bg-zinc-900"}`}>{labels[key]} · {filters[key]}</button>)}
            <label className="inline-flex items-center gap-2 px-2 text-xs text-zinc-600 dark:text-zinc-400"><input type="checkbox" checked={excludeApplied} onChange={(e) => setExcludeApplied(e.target.checked)} /> Hide applied</label>
          </div>
        </header>
        {busy ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-white dark:bg-zinc-900" />)}</div> : picks.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{picks.map((pick) => <InternshipCard key={pick.id} job={pick} onToggle={toggle} onDislike={dislike} />)}</div> : <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-zinc-500">No matching Top Picks. Add or broaden your keywords.</div>}
      </main>
    </div>
  );
}
