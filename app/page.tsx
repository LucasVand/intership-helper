"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InternshipCard, type Internship, type TagKey } from "./components/InternshipCard";
import { SiteNav } from "./components/SiteNav";

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

type Stats = {
  total: number;
  applied: number;
  notApplied: number;
  disliked: number;
};

const LIMIT = 48;
const TAG_FILTERS_STORAGE_KEY = "intership-helper:tag-filters";
const DEFAULT_TAG_FILTERS: Record<TagKey, TagFilter> = {
  is_faang: "all",
  is_closed: "all",
  no_sponsorship: "all",
  requires_citizenship: "all",
  requires_advanced_degree: "all",
};

type SortKey = "newest" | "oldest" | "company" | "role";
type AppliedFilter = "all" | "applied" | "not_applied";
type TagFilter = "all" | "only" | "exclude";
const TAG_DEFS: Array<{ key: TagKey; label: string; icon: string; activeClasses: string; dotClasses: string }> = [
  { key: "is_faang", label: "FAANG+", icon: "🔥", activeClasses: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800", dotClasses: "bg-orange-500" },
  { key: "requires_advanced_degree", label: "Advanced degree", icon: "🎓", activeClasses: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800", dotClasses: "bg-purple-500" },
  { key: "no_sponsorship", label: "No sponsorship", icon: "🛂", activeClasses: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800", dotClasses: "bg-red-500" },
  { key: "requires_citizenship", label: "U.S. Citizenship", icon: "🇺🇸", activeClasses: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800", dotClasses: "bg-blue-500" },
  { key: "is_closed", label: "Closed", icon: "🔒", activeClasses: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700", dotClasses: "bg-zinc-500" },
];

export default function Home() {
  const [internships, setInternships] = useState<Internship[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false });
  const [stats, setStats] = useState<Stats>({ total: 0, applied: 0, notApplied: 0, disliked: 0 });
  const [facets, setFacets] = useState<{ ages: string[] }>({ ages: [] });
  const metaSource = "db";
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [query, setQuery] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [ageFilter, setAgeFilter] = useState<string>("all");
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [tagFilters, setTagFilters] = useState<Record<TagKey, TagFilter>>(DEFAULT_TAG_FILTERS);
  const [tagFiltersHydrated, setTagFiltersHydrated] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(TAG_FILTERS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<Record<TagKey, TagFilter>>;
          const validValues: TagFilter[] = ["all", "only", "exclude"];
          const restored = { ...DEFAULT_TAG_FILTERS };
          (Object.keys(restored) as TagKey[]).forEach((key) => {
            if (validValues.includes(parsed[key] as TagFilter)) restored[key] = parsed[key] as TagFilter;
          });
          setTagFilters(restored);
        }
      } catch (e) {
        console.warn("Could not restore tag filters from local storage:", e);
      } finally {
        setTagFiltersHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!tagFiltersHydrated) return;
    try {
      localStorage.setItem(TAG_FILTERS_STORAGE_KEY, JSON.stringify(tagFilters));
    } catch (e) {
      console.warn("Could not save tag filters to local storage:", e);
    }
  }, [tagFilters, tagFiltersHydrated]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    const maxScroll = 80; // px to fully compact
    let ticking = false;
    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    const update = () => {
      const y = window.scrollY;
      const p = clamp(y / maxScroll, 0, 1);
      setScrollProgress(p);
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (ageFilter !== "all") params.set("age", ageFilter);
      if (appliedFilter !== "all") params.set("applied", appliedFilter);
      if (sort !== "newest") params.set("sort", sort);
      (Object.keys(tagFilters) as TagKey[]).forEach((k) => {
        if (tagFilters[k] !== "all") params.set(k, tagFilters[k]);
      });
      params.set("page", String(page));
      params.set("limit", String(LIMIT));
      const url = `/api/internships?${params.toString()}`;
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        const data = json.data as Internship[];
        const paginationRes = json.pagination as Pagination;
        const statsRes = json.stats as Stats;
        const facetsRes = json.facets as { ages: string[] };
        const source = json.meta?.source as "db" | undefined;
        setInternships((prev) => (append ? [...prev, ...data] : data));
        setPagination(paginationRes);
        if (statsRes) setStats(statsRes);
        if (facetsRes) setFacets(facetsRes);
        if (source && source !== "db") throw new Error("Unexpected data source");
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        console.error("fetchPage failed:", e);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [query, ageFilter, appliedFilter, sort, tagFilters]
  );

  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  const handleQueryInputChange = (v: string) => setQueryInput(v);
  const handleAgeChange = (v: string) => setAgeFilter(v);
  const handleAppliedChange = (v: AppliedFilter) => setAppliedFilter(v);
  const handleSortChange = (v: SortKey) => setSort(v);
  const handleLoadMore = () => {
    if (!pagination.hasMore || isLoadingMore) return;
    fetchPage(pagination.page + 1, true);
  };
  const handleClear = () => {
    setQueryInput("");
    setQuery("");
    setAgeFilter("all");
    setAppliedFilter("all");
    setSort("newest");
    setTagFilters({
      is_faang: "all",
      is_closed: "all",
      no_sponsorship: "all",
      requires_citizenship: "all",
      requires_advanced_degree: "all",
    });
  };
  const handleTagFilterChange = (key: TagKey, value: TagFilter) => {
    setTagFilters((prev) => ({ ...prev, [key]: value }));
  };
  const cycleTagFilter = (key: TagKey) => {
    setTagFilters((prev) => {
      const cur = prev[key];
      const next: TagFilter = cur === "all" ? "exclude" : cur === "exclude" ? "only" : "all";
      return { ...prev, [key]: next };
    });
  };
  const hasActiveTagFilters = (Object.values(tagFilters) as TagFilter[]).some((v) => v !== "all");
  const activeTagCount = (Object.values(tagFilters) as TagFilter[]).filter((v) => v !== "all").length;
  const handleCardTagClick = (key: TagKey) => {
    // clicking a badge focuses to "only" that tag — click again to clear
    setTagFilters((prev) => {
      const cur = prev[key];
      if (cur === "only") return { ...prev, [key]: "all" };
      return { ...prev, [key]: "only" };
    });
    // scroll to top so user sees filter applied
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleApplied = async (id: number) => {
    const current = internships.find((i) => i.id === id);
    if (!current) return;
    const nextApplied = !current.applied;
    const updateList = (list: Internship[]) => list.map((i) => (i.id === id ? { ...i, applied: nextApplied } : i));
    setInternships((prev) => updateList(prev));
    setStats((prev) => {
      if (appliedFilter !== "all") return prev;
      const delta = nextApplied ? 1 : -1;
      return { ...prev, applied: prev.applied + delta, notApplied: prev.notApplied - delta };
    });
    try {
      const res = await fetch("/api/internships", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, applied: nextApplied }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInternships((prev) => prev.map((i) => (i.id === id ? { ...i, applied: Boolean(data.applied) } : i)));
    } catch (e) {
      console.error("PATCH failed:", e);
      setInternships((prev) => prev.map((i) => (i.id === id ? { ...i, applied: current.applied } : i)));
    }
  };

  const toggleDisliked = async (id: number) => {
    const current = internships.find((i) => i.id === id);
    if (!current) return;
    const nextDisliked = !current.disliked;
    if (nextDisliked) {
      setInternships((prev) => prev.filter((i) => i.id !== id));
    } else {
      setInternships((prev) => prev.map((i) => (i.id === id ? { ...i, disliked: false } : i)));
    }
    try {
      const res = await fetch("/api/internships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, disliked: nextDisliked }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("PATCH disliked failed:", e);
      setInternships((prev) => (prev.some((i) => i.id === id) ? prev : [...prev, { ...current, disliked: current.disliked }]));
    }
  };

  // scroll-linked header metrics (0 = expanded, 1 = compact) — linear scrub from 0..80px
  const p = scrollProgress;
  const headerShadowOpacity = p * 0.08;
  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <SiteNav />
      <header
        className="sticky top-0 z-30 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80"
        style={{
          boxShadow: p > 0.01 ? `0 1px 8px rgba(0,0,0,${headerShadowOpacity})` : undefined,
        }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col" style={{ gap: `${16 - p * 8}px`, paddingTop: `${20 - p * 10}px`, paddingBottom: `${20 - p * 10}px` }}>
            <div className="flex flex-wrap items-start justify-between" style={{ gap: `${16 - p * 8}px` }}>
              <div className="min-w-0">
                <h1
                  className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
                  style={{ fontSize: `${30 - p * 10}px`, lineHeight: `${36 - p * 10}px` }}
                >
                  Internships <span className="font-normal text-zinc-500 dark:text-zinc-400">Summer 2027</span>
                </h1>
                <p
                  className="text-zinc-600 dark:text-zinc-400 max-w-2xl overflow-hidden"
                  style={{
                    marginTop: `${6 - p * 4}px`,
                    fontSize: `${14 - p * 2}px`,
                    opacity: 1 - p * 0.15,
                    maxHeight: `${80 - p * 55}px`,
                    display: p > 0.85 ? "none" : undefined,
                  }}
                >
                  Browse <span className="font-medium text-zinc-900 dark:text-zinc-100">{pagination.total.toLocaleString()}</span> internships{stats.applied > 0 && <> • <Link href="/applied" className="font-medium text-emerald-700 dark:text-emerald-300 hover:underline underline-offset-4">{stats.applied} applied</Link></>} . <span style={{ opacity: 1 - p * 0.8, display: p > 0.7 ? "none" : "inline" }}>Backend paginated (Postgres).</span> {pagination.total > 0 && <span className="ml-1 text-zinc-500 dark:text-zinc-500" style={{ opacity: 1 - p, display: p > 0.5 ? "none" : "inline" }}>Page {pagination.page}/{pagination.totalPages} • {LIMIT}/page</span>}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Link href="/applied" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" style={{ padding: `${4 + (1 - p) * 6}px ${10 + (1 - p) * 6}px`, fontSize: `${11 + (1 - p) * 1}px` }}>
                  <span className="text-sm">✓</span>{stats.applied} applied
                </Link>
                <Link href="/disliked" className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" style={{ padding: `${4 + (1 - p) * 6}px ${10 + (1 - p) * 6}px`, fontSize: `${11 + (1 - p) * 1}px` }}>
                  <span className="text-sm">♡</span>{stats.disliked} disliked
                </Link>
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                  style={{ padding: `${4 + (1 - p) * 4}px ${8 + (1 - p) * 4}px`, fontSize: `${11 + (1 - p) * 1}px` }}
                >
                  <span className={`h-2 w-2 rounded-full ${isLoading ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />{pagination.total.toLocaleString()} results{query || ageFilter !== "all" || appliedFilter !== "all" || hasActiveTagFilters ? " (filtered)" : ""}{hasActiveTagFilters ? ` • ${activeTagCount} tag` : ""}
                </span>
                <span className="inline-flex sm:hidden rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400" style={{ padding: `${4 + (1 - p) * 4}px ${8 + (1 - p) * 4}px`, fontSize: `${11 + (1 - p) * 1}px` }}>{pagination.total} results</span>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row" style={{ gap: `${12 - p * 4}px` }}>
              <div className="relative flex-1">
                <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 111 0-7.5 7.5 0 01-1 0z" /></svg>
                <input
                  value={queryInput}
                  onChange={(e) => handleQueryInputChange(e.target.value)}
                  placeholder="Search company, role, or location… (backend search)"
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-10 pr-4 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-white/10 focus:border-zinc-300 dark:focus:border-zinc-700"
                  style={{ paddingTop: `${8 + (1 - p) * 2}px`, paddingBottom: `${8 + (1 - p) * 2}px` }}
                />
                {queryInput && <button onClick={() => { setQueryInput(""); setQuery(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Clear search"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></button>}
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <div className="relative"><select value={ageFilter} onChange={(e) => handleAgeChange(e.target.value)} className="appearance-none rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-3 pr-8 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-white/10" style={{ paddingTop: `${8 + (1 - p) * 2}px`, paddingBottom: `${8 + (1 - p) * 2}px` }}><option value="all">All ages</option>{facets.ages.map((a) => <option key={a} value={a}>{a} {a === "0d" ? "(Today)" : ""}</option>)}</select><svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></div>
                <div className="relative"><select value={appliedFilter} onChange={(e) => handleAppliedChange(e.target.value as AppliedFilter)} className="appearance-none rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-3 pr-8 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-white/10" style={{ paddingTop: `${8 + (1 - p) * 2}px`, paddingBottom: `${8 + (1 - p) * 2}px` }}><option value="all">All • {stats.total}</option><option value="not_applied">Not applied • {stats.notApplied}</option><option value="applied">Applied • {stats.applied}</option></select><svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></div>
                <div className="relative flex-1 sm:flex-initial min-w-[150px]"><select value={sort} onChange={(e) => handleSortChange(e.target.value as SortKey)} className="w-full appearance-none rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-3 pr-8 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-white/10" style={{ paddingTop: `${8 + (1 - p) * 2}px`, paddingBottom: `${8 + (1 - p) * 2}px` }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="company">Company A–Z</option><option value="role">Role A–Z</option></select><svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></div>
                {(query || ageFilter !== "all" || appliedFilter !== "all" || sort !== "newest" || hasActiveTagFilters) && <button onClick={handleClear} className="hidden sm:inline-flex items-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800" style={{ padding: `${8 + (1 - p) * 2}px ${12 + (1 - p) * 2}px`, fontSize: "14px" }}>Clear</button>}
              </div>
            </div>
            {/* Tag filters — backend-filtered and scroll-linked */}
            <div className="flex flex-wrap items-center" style={{ gap: `${8 - p * 2}px` }}>
              <span className="font-medium text-zinc-700 dark:text-zinc-300" style={{ fontSize: `${12 - p * 1}px` }}>Filter tags:</span>
              {TAG_DEFS.map((def) => {
                const v = tagFilters[def.key];
                const isAll = v === "all";
                const isOnly = v === "only";
                const isExclude = v === "exclude";
                return (
                  <button
                    key={def.key}
                    onClick={() => cycleTagFilter(def.key)}
                    title={`Click to cycle: All → Hide → Only → All (current: ${v})`}
                    className={`inline-flex items-center rounded-full border font-medium ${
                      isOnly
                        ? def.activeClasses
                        : isExclude
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700 line-through decoration-zinc-400"
                          : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                    style={{
                      padding: `${4 + (1 - p) * 2}px ${8 + (1 - p) * 4}px`,
                      fontSize: `${11 + (1 - p) * 1}px`,
                      gap: `${4 + (1 - p) * 2}px`,
                    }}
                  >
                    <span>{def.icon}</span>
                    <span>{def.label}</span>
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${isOnly ? "bg-white/60 dark:bg-black/20" : isExclude ? "bg-zinc-200 dark:bg-zinc-700" : "bg-zinc-100 dark:bg-zinc-800"}`}>{isAll ? "All" : isOnly ? "Only" : "Hide"}</span>
                  </button>
                );
              })}
              {hasActiveTagFilters && (
                <button onClick={() => setTagFilters({ is_faang: "all", is_closed: "all", no_sponsorship: "all", requires_citizenship: "all", requires_advanced_degree: "all" })} className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline underline-offset-4">
                  Clear tags
                </button>
              )}
              <span className="text-zinc-400 dark:text-zinc-500 hidden sm:inline" style={{ fontSize: `${11 - p * 1}px`, opacity: 1 - p * 0.5, display: p > 0.7 ? "none" : undefined }}>— click to cycle All → Hide → Only</span>
            </div>
            {(query || ageFilter !== "all" || appliedFilter !== "all" || hasActiveTagFilters) && <div className="flex flex-wrap gap-2 text-xs">{query && <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 dark:bg-white px-3 py-1 font-medium text-white dark:text-zinc-900">&quot;{query}&quot;<button onClick={() => { setQueryInput(""); setQuery(""); }} className="ml-1 rounded-full hover:bg-white/20 dark:hover:bg-black/10 p-0.5"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></button></span>}{ageFilter !== "all" && <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-1 font-medium text-zinc-700 dark:text-zinc-300">{ageFilter}<button onClick={() => handleAgeChange("all")} className="ml-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 p-0.5"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></button></span>}{appliedFilter !== "all" && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-3 py-1 font-medium text-emerald-800 dark:text-emerald-300">{appliedFilter === "applied" ? "Applied" : "Not applied"}<button onClick={() => handleAppliedChange("all")} className="ml-1 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900 p-0.5"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></button></span>}{(Object.keys(tagFilters) as TagKey[]).filter((k) => tagFilters[k] !== "all").map((k) => {
                const def = TAG_DEFS.find((d) => d.key === k)!;
                const v = tagFilters[k];
                return (
                  <span key={k} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-medium ${v === "only" ? def.activeClasses : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"}`}>
                    <span>{def.icon}</span>{def.label} — {v === "only" ? "Only" : "Hide"}<button onClick={() => handleTagFilterChange(k, "all")} className="ml-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 p-0.5"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                  </span>
                );
              })}</div>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {isLoading && internships.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 h-48" />)}</div>
        ) : internships.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-12 text-center">
            <div className="mx-auto max-w-sm">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800"><svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg></div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">No internships found</h3>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">Try adjusting your search or filters. Backend pagination returned 0 for page {pagination.page}.</p>
              <button onClick={handleClear} className="mt-4 rounded-full bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100">Clear filters</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400"><span>Showing <span className="font-medium text-zinc-900 dark:text-zinc-100">{internships.length.toLocaleString()}</span> of <span className="font-medium text-zinc-900 dark:text-zinc-100">{pagination.total.toLocaleString()}</span> • page {pagination.page}/{pagination.totalPages} • {metaSource} • limit {LIMIT}</span><span className="hidden sm:inline">Backend paginated • {facets.ages.length} ages</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {internships.map((job) => <InternshipCard key={job.id} job={job} onToggle={toggleApplied} onDislike={toggleDisliked} showLegend onTagClick={handleCardTagClick} />)}
            </div>
            {pagination.hasMore && <div className="flex justify-center"><button onClick={handleLoadMore} disabled={isLoadingMore} className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm disabled:opacity-50">{isLoadingMore ? "Loading…" : `Load more — ${pagination.total - internships.length} remaining`}</button></div>}
            <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"><span>Page {pagination.page} of {pagination.totalPages}</span><span>•</span><span>{pagination.hasMore ? "More pages via backend" : "End of results"}</span><span>•</span><span>limit={LIMIT} offset={(pagination.page - 1) * LIMIT}</span></div>
            <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">{pagination.total} internships • backend paginated • sorted by {sort} • {ageFilter === "all" ? "all ages" : ageFilter} • {appliedFilter === "all" ? "all" : appliedFilter}{hasActiveTagFilters ? ` • tags: ${(Object.entries(tagFilters) as [TagKey, TagFilter][]).filter(([, v]) => v !== "all").map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}</p>
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400"><span>Built with Next.js + Drizzle • Backend pagination via <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">/api/internships?page&limit&q&age&applied&sort</code> • Top Picks via <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded">/api/top-picks</code></span><span className="font-mono">{pagination.total} total • {stats.applied} applied • {metaSource} • limit {LIMIT}</span></div>
        </div>
      </footer>
    </div>
  );
}
