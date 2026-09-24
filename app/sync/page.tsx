"use client";

import { useCallback, useEffect, useState } from "react";
import { SiteNav } from "../components/SiteNav";

type SyncRunDetails = {
  perSource?: Record<string, { scraped: number; inserted: number; updated: number }>;
  reasonCounts?: Record<string, number>;
  insertedSample?: Array<{ company: string; role: string; location: string; source: string; applicationLink: string }>;
  updatedSample?: Array<{ id: number; company: string; role: string; source: string; reasons: string[] }>;
};

type SyncRun = {
  id: number;
  createdAt: string;
  scrapedCount: number;
  existingCount: number;
  insertedCount: number;
  updatedCount: number;
  totalAfter: number;
  durationMs: number;
  status: string;
  error: string | null;
  scrapedUrl: string | null;
  source: string;
  details?: SyncRunDetails | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

const LIMIT = 20;

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function statusClasses(status: string) {
  switch (status) {
    case "success":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800";
    case "dry_run":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "failed":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "no_db":
      return "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
}

function sourceBadgeClasses(source: string) {
  if (source === "simplify") return "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300";
  if (source === "canadian-tech") return "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300";
  return "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300";
}

export default function SyncHistoryPage() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchRuns = useCallback(async (page: number, append: boolean) => {
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sync-runs?page=${page}&limit=${LIMIT}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const data = json.data as SyncRun[];
      const paginationRes = json.pagination as Pagination;
      setRuns((prev) => (append ? [...prev, ...data] : data));
      setPagination(paginationRes);
    } catch (e: any) {
      console.error("fetchRuns failed:", e);
      setError(e?.message ?? "Failed to load sync history");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns(1, false);
  }, [fetchRuns]);

  const handleLoadMore = () => {
    if (!pagination.hasMore || isLoadingMore) return;
    fetchRuns(pagination.page + 1, true);
  };

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <SiteNav />
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 py-5 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm">⧗</span>
                  Sync History
                </h1>
                <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
                  {isLoading ? "Loading…" : `${pagination.total.toLocaleString()} sync runs • Page ${pagination.page}/${pagination.totalPages}`}
                  <span className="hidden sm:inline"> • Tracks time, entries added/updated, and status</span>
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => fetchRuns(1, false)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Refresh
                </button>
              </div>
            </div>
            {error && (
              <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-5 py-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-sm">!</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-red-900 dark:text-red-100">Database not set up — cannot load sync history</p>
                    <p className="mt-1 text-sm text-red-800 dark:text-red-200 break-words">{error}</p>
                    {error.toLowerCase().includes("database not configured") || error.toLowerCase().includes("not set up") ? (
                      <div className="mt-3 rounded-lg bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-800 p-3">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Fix:</p>
                        <ol className="mt-1 list-decimal list-inside space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                          <li>
                            Set <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">DATABASE_URL</code> in <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">.env</code> (see <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">.env.example</code>)
                          </li>
                          <li>
                            Run <code className="font-mono bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-1.5 py-0.5 rounded">npm run db:setup</code> (or <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">docker compose up -d db && npm run db:migrate</code>)
                          </li>
                          <li>
                            Then run <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">npm run db:sync</code> to create history entries and reload this page
                          </li>
                        </ol>
                      </div>
                    ) : error.toLowerCase().includes("not found") || error.toLowerCase().includes("migrate") ? (
                      <div className="mt-3 rounded-lg bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 p-3">
                        <p className="text-xs text-zinc-700 dark:text-zinc-300">
                          The <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">sync_runs</code> table is missing — run <code className="font-mono bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-1.5 py-0.5 rounded">npm run db:migrate</code>.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {isLoading && runs.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 h-28" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-12 text-center">
            <div className="mx-auto max-w-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">No sync runs yet</h3>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                Run the sync script to populate history. It records time, counts, and status for each run.
              </p>
              <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-left">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Run sync:</p>
                <code className="mt-1 block font-mono text-xs text-zinc-600 dark:text-zinc-400">npm run db:sync</code>
                <code className="mt-1 block font-mono text-xs text-zinc-600 dark:text-zinc-400">npm run db:sync:dry -- --dry-run</code>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {runs.map((run) => {
                const isExpanded = expandedId === run.id;
                const hasDetails = !!run.details?.perSource;
                const perSourceEntries = run.details?.perSource ? Object.entries(run.details.perSource) : [];
                const reasonEntries = run.details?.reasonCounts ? Object.entries(run.details.reasonCounts) : [];
                return (
                  <div key={run.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(run.status)}`}>{run.status}</span>
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{formatDate(run.createdAt)}</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">• {run.source} • {formatDuration(run.durationMs)} • id {run.id}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2.5 py-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Scraped <span className="font-medium text-zinc-900 dark:text-zinc-100">{run.scrapedCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2.5 py-1">
                            Existing <span className="font-medium text-zinc-900 dark:text-zinc-100">{run.existingCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-emerald-800 dark:text-emerald-300">
                            + Added <span className="font-bold">{run.insertedCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2.5 py-1 text-blue-800 dark:text-blue-300">
                            ~ Updated <span className="font-bold">{run.updatedCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-zinc-700 dark:text-zinc-300">
                            Total <span className="font-medium text-zinc-900 dark:text-zinc-100">{run.totalAfter}</span>
                          </span>
                        </div>

                        {/* Per-source breakdown */}
                        {hasDetails ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {perSourceEntries.map(([src, stats]) => (
                              <span
                                key={src}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${sourceBadgeClasses(src)}`}
                                title={`${src}: scraped ${stats.scraped}, inserted ${stats.inserted}, updated ${stats.updated}`}
                              >
                                <span className="font-semibold">{src}</span>
                                <span className="opacity-75">•</span>
                                <span>scraped {stats.scraped}</span>
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-white/60 dark:bg-black/20 px-1.5 py-0.5 text-[11px]">
                                  +{stats.inserted} ~{stats.updated}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 italic">No per-source breakdown (run before detailed tracking)</div>
                        )}

                        {/* Reason breakdown */}
                        {reasonEntries.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">Why updated:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {reasonEntries.map(([reason, count]) => (
                                <span
                                  key={reason}
                                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-2.5 py-1 text-xs text-amber-800 dark:text-amber-300"
                                  title={`${count} rows changed due to ${reason}`}
                                >
                                  {reason} <span className="font-bold">×{count}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {run.scrapedUrl && <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Source: {run.scrapedUrl}</p>}
                        {run.error && (
                          <div className="mt-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                            <span className="font-medium">Error:</span> {run.error}
                          </div>
                        )}

                        {/* Expandable samples */}
                        {hasDetails && (run.details?.insertedSample?.length || run.details?.updatedSample?.length) ? (
                          <div className="mt-3">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : run.id)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            >
                              <span>{isExpanded ? "Hide details" : "Show details"}</span>
                              <span className="text-[11px] opacity-60">({run.details?.insertedSample?.length ?? 0} added, {run.details?.updatedSample?.length ?? 0} updated samples)</span>
                              <svg className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="mt-3 space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4">
                                {run.details?.insertedSample && run.details.insertedSample.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Added samples (first {run.details.insertedSample.length}):</p>
                                    <ul className="space-y-1">
                                      {run.details.insertedSample.map((item, idx) => (
                                        <li key={idx} className="text-xs text-zinc-600 dark:text-zinc-400 font-mono truncate">
                                          <span className="inline-flex items-center rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 text-[11px] font-sans mr-1.5">+{item.source}</span>
                                          {item.company} — {item.role} — {item.location}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {run.details?.updatedSample && run.details.updatedSample.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Updated samples (first {run.details.updatedSample.length}):</p>
                                    <ul className="space-y-2">
                                      {run.details.updatedSample.map((item) => (
                                        <li key={item.id} className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-2">
                                          <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                            <span className="inline-flex items-center rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 text-[11px] mr-1.5">~{item.source}</span>
                                            {item.company} — {item.role} <span className="font-normal text-zinc-500">#{item.id}</span>
                                          </div>
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {item.reasons.map((r, i) => (
                                              <span key={i} className="inline-flex items-center rounded-full bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                                                {r}
                                              </span>
                                            ))}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                        <div className="font-mono">{new Date(run.createdAt).toISOString().slice(0, 19).replace("T", " ")}</div>
                        <div className="mt-1 text-[11px]">{run.durationMs}ms</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {pagination.hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm disabled:opacity-50"
                >
                  {isLoadingMore ? "Loading…" : `Load more — ${pagination.total - runs.length} remaining`}
                </button>
              </div>
            )}
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <span>•</span>
              <span>{pagination.hasMore ? "More runs" : "End of history"}</span>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Sync history • via <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">/api/sync-runs</code> • table <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">sync_runs</code>
            </span>
            <span className="font-mono">{pagination.total} runs • limit {LIMIT}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
