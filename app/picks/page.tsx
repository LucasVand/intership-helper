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
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 24, total: 0, totalPages: 1, hasMore: false });
  const [newKeyword, setNewKeyword] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [keywordBusy, setKeywordBusy] = useState(false);
  const [showKeywordsManager, setShowKeywordsManager] = useState(false);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("intership-helper:picks-tag-filters");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<TagKey, TagFilter>>;
        setFilters((current) => ({ ...current, ...keys.reduce((result, key) => {
          const value = parsed[key];
          result[key] = value === "all" || value === "only" || value === "exclude" ? value : current[key];
          return result;
        }, {} as Record<TagKey, TagFilter>) }));
      }
    } catch (error) {
      console.warn("Could not restore Top Picks tag filters:", error);
    } finally {
      setFiltersHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      localStorage.setItem("intership-helper:picks-tag-filters", JSON.stringify(filters));
    } catch (error) {
      console.warn("Could not save Top Picks tag filters:", error);
    }
  }, [filters, filtersHydrated]);

  const load = useCallback(async (requestedPage = page) => {
    setBusy(true);
    const params = new URLSearchParams({ limit: "24", page: String(requestedPage) });
    if (!excludeApplied) params.set("exclude_applied", "false");
    keys.forEach((key) => filters[key] !== "all" && params.set(key, filters[key]));
    const [keywordRes, picksRes] = await Promise.all([fetch("/api/keywords"), fetch(`/api/top-picks?${params}`)]);
    if (keywordRes.ok) setKeywords(await keywordRes.json());
    if (picksRes.ok) {
      const json = await picksRes.json();
      setPicks(json.data);
      setPagination(json.pagination);
      setPage(json.pagination.page);
    }
    setBusy(false);
  }, [excludeApplied, filters, page]);

  useEffect(() => { if (filtersHydrated) load(1); }, [excludeApplied, filters, filtersHydrated]);
  const addKeyword = async () => {
    const value = newKeyword.trim();
    if (!value) return;
    setKeywordBusy(true);
    setKeywordError(null);
    try {
      const res = await fetch("/api/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword: value }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setKeywords((prev) => [...prev, json].sort((a, b) => a.keyword.localeCompare(b.keyword)));
      setNewKeyword("");
      load(1);
    } catch (error) {
      setKeywordError(error instanceof Error ? error.message : "Failed to add keyword");
    } finally {
      setKeywordBusy(false);
    }
  };
  const saveKeyword = async (id: number) => {
    const value = editingValue.trim();
    if (!value) return;
    setKeywordBusy(true);
    setKeywordError(null);
    try {
      const res = await fetch("/api/keywords", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, keyword: value }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setKeywords((prev) => prev.map((keyword) => keyword.id === id ? json : keyword).sort((a, b) => a.keyword.localeCompare(b.keyword)));
      setEditingId(null);
      setEditingValue("");
      load(1);
    } catch (error) {
      setKeywordError(error instanceof Error ? error.message : "Failed to update keyword");
    } finally {
      setKeywordBusy(false);
    }
  };
  const deleteKeyword = async (id: number) => {
    setKeywordBusy(true);
    setKeywordError(null);
    try {
      const res = await fetch(`/api/keywords?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setKeywords((prev) => prev.filter((keyword) => keyword.id !== id));
      load(1);
    } catch (error) {
      setKeywordError(error instanceof Error ? error.message : "Failed to delete keyword");
    } finally {
      setKeywordBusy(false);
    }
  };
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
          <button onClick={() => setShowKeywordsManager(true)} className="mt-5 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">Manage keywords — {keywords.length}</button>
          <div className="mt-4 flex flex-wrap gap-2">
            {keys.map((key) => <button key={key} onClick={() => setFilters((prev) => ({ ...prev, [key]: prev[key] === "all" ? "exclude" : prev[key] === "exclude" ? "only" : "all" }))} className={`rounded-full border px-3 py-1.5 text-xs ${filters[key] === "only" ? "bg-zinc-900 text-white" : filters[key] === "exclude" ? "line-through text-zinc-500" : "bg-white dark:bg-zinc-900"}`}>{labels[key]} · {filters[key]}</button>)}
            <label className="inline-flex items-center gap-2 px-2 text-xs text-zinc-600 dark:text-zinc-400"><input type="checkbox" checked={excludeApplied} onChange={(e) => setExcludeApplied(e.target.checked)} /> Hide applied</label>
          </div>
        </header>
        {busy ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-white dark:bg-zinc-900" />)}</div> : picks.length ? <><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{picks.map((pick) => <InternshipCard key={pick.id} job={pick} onToggle={toggle} onDislike={dislike} />)}</div><div className="flex items-center justify-center gap-4 text-xs text-zinc-500"><button disabled={page <= 1 || busy} onClick={() => load(page - 1)} className="rounded-full border px-4 py-2 disabled:opacity-40">← Previous</button><span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} matches</span><button disabled={!pagination.hasMore || busy} onClick={() => load(page + 1)} className="rounded-full border px-4 py-2 disabled:opacity-40">Next →</button></div></> : <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-zinc-500">No matching Top Picks. Add or broaden your keywords.</div>}
      </main>
      {showKeywordsManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowKeywordsManager(false)} aria-label="Close" />
          <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div><h2 className="text-sm font-semibold">Top Picks Keywords</h2><p className="text-xs text-zinc-500">Saved globally in Postgres and matched against company, role, and location.</p></div>
              <button onClick={() => setShowKeywordsManager(false)} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">×</button>
            </div>
            <div className="space-y-4 overflow-auto p-5">
              <div className="flex gap-2">
                <input value={newKeyword} onChange={(event) => setNewKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addKeyword(); }} placeholder="Add keyword e.g. Backend" className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                <button onClick={addKeyword} disabled={keywordBusy || !newKeyword.trim()} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">Add</button>
              </div>
              {keywordError && <p className="text-xs text-red-600 dark:text-red-400">{keywordError}</p>}
              <div className="space-y-2">
                {keywords.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-center text-sm text-zinc-500">No keywords yet.</p> : keywords.map((keyword) => (
                  <div key={keyword.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                    {editingId === keyword.id ? <><input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveKeyword(keyword.id); if (event.key === "Escape") setEditingId(null); }} className="flex-1 rounded-lg border px-2 py-1.5 text-sm dark:bg-zinc-900" autoFocus /><button onClick={() => saveKeyword(keyword.id)} disabled={keywordBusy} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs text-white">Save</button><button onClick={() => setEditingId(null)} className="rounded-full border px-3 py-1.5 text-xs">Cancel</button></> : <><span className="flex-1 truncate text-sm font-medium">{keyword.keyword}</span><button onClick={() => { setEditingId(keyword.id); setEditingValue(keyword.keyword); setKeywordError(null); }} className="rounded-full border px-2.5 py-1 text-xs">Edit</button><button onClick={() => deleteKeyword(keyword.id)} disabled={keywordBusy} className="rounded-full border border-red-200 px-2.5 py-1 text-xs text-red-600">Remove</button></>}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-800"><button onClick={() => setShowKeywordsManager(false)} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
