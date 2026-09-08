"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Internships", icon: "⌕" },
  { href: "/picks", label: "Top Picks", icon: "★" },
  { href: "/applied", label: "Applied", icon: "✓" },
  { href: "/disliked", label: "Disliked", icon: "♡" },
  { href: "/sync", label: "Sync", icon: "⧗" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [counts, setCounts] = useState({ applied: 0, disliked: 0 });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internships?limit=1&disliked=all")
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.stats) {
          setCounts({
            applied: Number(json.stats.applied) || 0,
            disliked: Number(json.stats.disliked) || 0,
          });
        }
      })
      .catch((error) => console.error("Failed to load navigation counts:", error));
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <nav className="border-b border-zinc-200 bg-white/90 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="mr-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Internship Helper</Link>
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const count = item.href === "/applied" ? counts.applied : item.href === "/disliked" ? counts.disliked : null;
            return (
              <Link key={item.href} href={item.href} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${active ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
                <span>{item.icon}</span>{item.label}
                {count !== null && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? "bg-white/20 dark:bg-black/10" : item.href === "/applied" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"}`}>{count}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
