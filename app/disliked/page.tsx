"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InternshipCard, type Internship } from "../components/InternshipCard";

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

const LIMIT = 48;

export default function DislikedPage() {
  const [internships, setInternships] = useState<Internship[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDisliked = useCallback(async (page: number, append: boolean) => {
    const params = new URLSearchParams({ disliked: "disliked", include_disliked: "true", page: String(page), limit: String(LIMIT), sort: "newest" });
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/internships?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setInternships((prev) => (append ? [...prev, ...json.data] : json.data));
      setPagination(json.pagination);
    } catch (e) {
      console.error("fetchDisliked failed:", e);
      setError(e instanceof Error ? e.message : "Failed to load disliked internships");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchDisliked(1, false);
  }, [fetchDisliked]);

  const toggleDisliked = async (id: number) => {
    const current = internships.find((job) => job.id === id);
    if (!current) return;
    setInternships((prev) => prev.filter((job) => job.id !== id));
    setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, prev.total - 1) / prev.limit)) }));
    try {
      const res = await fetch("/api/internships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, disliked: false }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("PATCH disliked failed:", e);
      setInternships((prev) => [...prev, current]);
      setPagination((prev) => ({ ...prev, total: prev.total + 1, totalPages: Math.max(1, Math.ceil((prev.total + 1) / prev.limit)) }));
    }
  };

  const toggleApplied = async (id: number) => {
    const current = internships.find((job) => job.id === id);
    if (!current) return;
    setInternships((prev) => prev.map((job) => (job.id === id ? { ...job, applied: !job.applied } : job)));
    try {
      const res = await fetch("/api/internships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, applied: !current.applied }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("PATCH applied failed:", e);
      setInternships((prev) => prev.map((job) => (job.id === id ? current : job)));
    }
  };

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-sm text-white">♡</span>
                Disliked Internships
              </h1>
              <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {isLoading ? "Loading…" : `${pagination.total.toLocaleString()} marked as not interested`}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Link href="/" className="rounded-full bg-zinc-900 px-3.5 py-1.5 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">← Back to listings</Link>
              <Link href="/applied" className="rounded-full bg-emerald-600 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-700">✓ Applied</Link>
            </div>
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">{error}</div>}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {isLoading && internships.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-48 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />)}</div>
        ) : internships.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No disliked internships</h3>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">Internships marked as not interested will appear here.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {internships.map((job) => <InternshipCard key={job.id} job={job} onToggle={toggleApplied} onDislike={toggleDisliked} />)}
            </div>
            {pagination.hasMore && <div className="mt-6 flex justify-center"><button onClick={() => fetchDisliked(pagination.page + 1, true)} disabled={isLoadingMore} className="rounded-full border border-zinc-200 bg-white px-6 py-2.5 text-sm font-medium text-zinc-700 shadow-sm disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">{isLoadingMore ? "Loading…" : `Load more — ${pagination.total - internships.length} remaining`}</button></div>}
          </>
        )}
      </main>
    </div>
  );
}
