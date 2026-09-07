"use client";

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
  return (
    <nav className="border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="mr-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Internship Helper</Link>
        <div className="flex flex-1 flex-wrap gap-1">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
                <span className="mr-1">{item.icon}</span>{item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
