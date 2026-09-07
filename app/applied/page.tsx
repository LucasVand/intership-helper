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

export default function AppliedPage() {
  const [internships, setInternships] = useState<Internship[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApplied = useCallback(async (page: number, append: boolean) => {
    const params = new URLSearchParams();
    params.set("applied", "applied");
    params.set("page", String(page));
    params.set("limit", String(LIMIT));
    // always request paginated mode
    params.set("sort", "newest");
    const url = `/api/internships?${params.toString()}`;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data as Internship[];
      const paginationRes = json.pagination as Pagination;
      setInternships((prev) => (append ? [...prev, ...data] : data));
      setPagination(paginationRes);
    } catch (e: any) {
      console.error("fetchApplied failed:", e);
      setError(e?.message ?? "Failed to load applied internships");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchApplied(1, false);
  }, [fetchApplied]);

  const handleLoadMore = () => {
    if (!pagination.hasMore || isLoadingMore) return;
    fetchApplied(pagination.page + 1, true);
  };

  const toggleApplied = async (id: number) => {
    const current = internships.find((i) => i.id === id);
    if (!current) return;
    // optimistically remove from applied list (since we show only applied)
    setInternships((prev) => prev.filter((i) => i.id !== id));
    setPagination((prev) => ({
      ...prev,
      total: Math.max(0, prev.total - 1),
      totalPages: Math.max(1, Math.ceil(Math.max(0, prev.total - 1) / prev.limit)),
    }));
    try {
      const res = await fetch("/api/internships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, applied: false }),
      });
      if (!res.ok) throw new Error(await res.text());
      // success — already removed
    } catch (e) {
      console.error("PATCH failed:", e);
      setInternships((prev) => {
        const exists = prev.some((p) => p.id === id);
        if (exists) return prev;
        return [...prev, { ...current, applied: true }].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      });
      setPagination((prev) => ({
        ...prev,
        total: prev.total + 1,
        totalPages: Math.max(1, Math.ceil((prev.total + 1) / prev.limit)),
      }));
    }
  };

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 py-5 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white text-sm">✓</span>
                  Applied Internships
                </h1>
                <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
                  {isLoading ? (
                    "Loading…"
                  ) : (
                    <>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{pagination.total.toLocaleString()}</span> marked as applied
                      {" • Postgres"} • Page {pagination.page}/{pagination.totalPages}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Link href="/" className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 dark:bg-white px-3.5 py-1.5 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100">
                  ← Back to listings
                </Link>
                <Link href="/sync" className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  ⧗ Sync
                </Link>
                <Link href="/disliked" className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700">
                  ♡ Disliked
                </Link>
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-zinc-600 dark:text-zinc-400">
                  <span className={`h-2 w-2 rounded-full ${isLoading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                  {pagination.total.toLocaleString()} applied
                </span>
              </div>
            </div>
            {error && <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {isLoading && internships.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 h-48" />
            ))}
          </div>
        ) : internships.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-12 text-center">
            <div className="mx-auto max-w-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <svg className="h-6 w-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">No applied internships yet</h3>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                Mark internships as applied on the main listings page. They will appear here for easy tracking.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-zinc-900 dark:bg-white px-5 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100"
              >
                Browse internships
              </Link>
              <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                Applied status is stored in Postgres.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Showing <span className="font-medium text-zinc-900 dark:text-zinc-100">{internships.length.toLocaleString()}</span> of{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{pagination.total.toLocaleString()}</span> applied • page {pagination.page}/{pagination.totalPages}
              </span>
              <Link href="/" className="hidden sm:inline text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline underline-offset-4">
                Back to all listings
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {internships.map((job) => (
                <InternshipCard key={job.id} job={job} onToggle={toggleApplied} />
              ))}
            </div>
            {pagination.hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm disabled:opacity-50"
                >
                  {isLoadingMore ? "Loading…" : `Load more — ${pagination.total - internships.length} remaining`}
                </button>
              </div>
            )}
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <span>•</span>
              <span>{pagination.hasMore ? "More pages" : "End of applied"}</span>
              <span>•</span>
              <span>limit={LIMIT}</span>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Applied page • fetched via <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">/api/internships?applied=applied</code>
            </span>
            <span className="font-mono">{pagination.total} applied • db • limit {LIMIT}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
