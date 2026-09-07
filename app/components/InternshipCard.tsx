export type Internship = {
  id: number;
  company: string;
  role: string;
  location: string;
  application_links: string[];
  age?: string;
  posted_at?: string;
  applied: boolean;
  disliked: boolean;
  no_sponsorship?: boolean;
  requires_citizenship?: boolean;
  is_closed?: boolean;
  is_faang?: boolean;
  requires_advanced_degree?: boolean;
};

export type TagKey = "is_faang" | "is_closed" | "no_sponsorship" | "requires_citizenship" | "requires_advanced_degree";

function ageBadgeClasses(age?: string): string {
  const d = (() => {
    if (!age) return 999;
    const m = age.match(/(\d+)/);
    if (!m) return 999;
    return parseInt(m[1], 10);
  })();
  if (d === 0) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
  if (d === 1) return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800";
  if (d <= 3) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700";
}

function formatAgeLabel(age?: string): string {
  if (!age) return "—";
  const match = age.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|mo|mos)$/);
  if (!match) return `${age} ago`;

  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "m" || unit === "min" || unit === "mins") return `${value} minute${value === 1 ? "" : "s"} ago`;
  if (unit === "h" || unit === "hr" || unit === "hrs") return `${value} hour${value === 1 ? "" : "s"} ago`;
  if (unit === "d" || unit === "day" || unit === "days") {
    if (value === 0) return "Under 24 hours ago";
    if (value === 1) return "1 day ago";
  }
  return `${age} ago`;
}

function LegendBadges({ job, onTagClick }: { job: Internship; onTagClick?: (key: TagKey) => void }) {
  const badges: Array<{ key: string; tagKey: TagKey; label: string; icon: string; classes: string }> = [];
  if (job.is_faang) badges.push({ key: "faang", tagKey: "is_faang", label: "FAANG+", icon: "🔥", classes: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800" });
  if (job.requires_advanced_degree) badges.push({ key: "adv", tagKey: "requires_advanced_degree", label: "Advanced degree", icon: "🎓", classes: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800" });
  if (job.no_sponsorship) badges.push({ key: "nospon", tagKey: "no_sponsorship", label: "No sponsorship", icon: "🛂", classes: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800" });
  if (job.requires_citizenship) badges.push({ key: "citizen", tagKey: "requires_citizenship", label: "U.S. Citizenship", icon: "🇺🇸", classes: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" });
  if (job.is_closed) badges.push({ key: "closed", tagKey: "is_closed", label: "Closed", icon: "🔒", classes: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 line-through" });
  if (!badges.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {badges.map((b) =>
        onTagClick ? (
          <button key={b.key} onClick={() => onTagClick(b.tagKey)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-95 hover:scale-[1.02] active:scale-[0.98] ${b.classes}`} title={`Filter by ${b.label} — click to show only ${b.label}`}>
            <span>{b.icon}</span>{b.label}
          </button>
        ) : (
          <span key={b.key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.classes}`} title={b.label}>
            <span>{b.icon}</span>{b.label}
          </span>
        )
      )}
    </div>
  );
}

export function InternshipCard({ job, onToggle, onDislike, showLegend = true, onTagClick }: { job: Internship; onToggle: (id: number) => void; onDislike?: (id: number) => void; showLegend?: boolean; onTagClick?: (key: TagKey) => void }) {
  const primaryLink = job.application_links[0];
  const simplifyLink = job.application_links.find((l) => l.includes("simplify.jobs")) ?? job.application_links[1];
  const hasTwoDistinct = job.application_links.length > 1 && primaryLink !== simplifyLink;
  return (
    <article
      className={`group flex flex-col rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all ${
        job.is_closed
          ? "opacity-75 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900"
          : job.applied
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 hover:border-emerald-300 dark:hover:border-emerald-700"
            : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400 uppercase">{job.company}</h2>
          <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100 group-hover:text-black dark:group-hover:text-white">{job.role}</h3>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${ageBadgeClasses(job.age)}`} title={job.posted_at ? `Posted ${new Date(job.posted_at).toLocaleString()}` : `Posted ${job.age ?? "unknown"} ago`}>
          {formatAgeLabel(job.age)}
        </span>
      </div>
      {showLegend && <LegendBadges job={job} onTagClick={onTagClick} />}
      <div className="mt-3 flex items-start gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <span className="line-clamp-2 break-words leading-snug">{job.location || "Location not specified"}</span>
      </div>
      <div className="mt-4">
        <button
          onClick={() => onToggle(job.id)}
          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            job.applied
              ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          }`}
        >
          {job.applied ? (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Applied
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Mark as applied
            </>
          )}
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {primaryLink ? (
          <a
            href={primaryLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-zinc-900 dark:bg-white px-4 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
          >
            Apply
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        ) : (
          <span className="inline-flex flex-1 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-400">No link</span>
        )}
        {hasTwoDistinct && simplifyLink ? (
          <a
            href={simplifyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="View on Simplify.jobs"
          >
            Simplify
          </a>
        ) : null}
      </div>
      {onDislike && (
        <button
          onClick={() => onDislike(job.id)}
          className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
            job.disliked
              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
          title={job.disliked ? "Remove from disliked internships" : "Not interested in this internship"}
        >
          {job.disliked ? "♥ Disliked" : "♡ Not interested"}
        </button>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
        <span className="truncate">
          {job.application_links.length} link{job.application_links.length !== 1 ? "s" : ""} • id {job.id}
        </span>
        <span className="font-mono flex items-center gap-1.5">
          {job.applied && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />} {job.age ?? "—"}
        </span>
      </div>
    </article>
  );
}
