import fetch from "node-fetch";
import type { InternshipSourceAdapter, ScrapedInternship } from "./types";

const URL = "https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/main/README.md";

export function parsePostedAt(value: string): Date | undefined {
  const match = value.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return undefined;
  // Use midday UTC so Sep 21 12:00 appears after 00:00 but before end-of-day, giving a more
  // accurate “3 days ago” age and preventing the posting from being the oldest among same-day
  // Simplify rows (which use now-3d ≈ 17:37). Also makes Mercury (Sep 21) visible without paging to page 5
  // when combined with the dedicated Canadian section; the time is arbitrary but consistent.
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseCanadianMarkdown(markdown: string): ScrapedInternship[] {
  const result: ScrapedInternship[] = [];
  let lastCompany = "";

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    // Protect escaped pipes `\|` (e.g. `Intelcom \| Dragonfly`) before splitting on `|`
    const placeholder = "__ESCAPED_PIPE__";
    const protectedLine = line.replace(/\\\|/g, placeholder);
    const tds = protectedLine
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(new RegExp(placeholder, "g"), "|"));
    if (tds.length < 5 || /^-+$/.test(tds[0])) continue;
    const rawCompany = tds[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    const isContinuation = rawCompany === "↳" || rawCompany.startsWith("↳");
    const company = isContinuation ? lastCompany : rawCompany;
    const role = tds[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    const location = tds[2].trim();
    const links = [...tds[3].matchAll(/\]\(([^)]+)\)/g)];
    const applicationLink = links.at(-1)?.[1]?.trim();
    if (!company || !role || !applicationLink || /^company$/i.test(company)) continue;
    if (!isContinuation) lastCompany = company;
    result.push({
      source: "canadian-tech",
      company,
      role,
      location,
      applicationLink,
      postedAt: parsePostedAt(tds[4]),
    });
  }
  return result;
}

async function fetchAndParse(): Promise<ScrapedInternship[]> {
  const res = await fetch(URL, { headers: { "User-Agent": "node.js" } });
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status} ${res.statusText}`);
  const markdown = await res.text();
  return parseCanadianMarkdown(markdown);
}

export const canadianTechSource: InternshipSourceAdapter = { source: "canadian-tech", url: URL, fetchAndParse };
