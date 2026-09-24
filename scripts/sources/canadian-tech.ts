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
    // Robustly extract the last markdown link URL, handling URLs that contain '(' and ')' like
    // https://jobs.l3harris.com/job/Waterdown-Software-Engineering-Co-Op-(Waterdown,-CAN)-ON-L9H-0C5/1430130200/?ats=successfactors
    // The simple regex /\]\(([^)]+)\)/ stops at the first ')' inside the URL and truncates to
    // https://jobs.l3harris.com/job/Waterdown-Software-Engineering-Co-Op-(Waterdown,-CAN
    // which caused 3 L3Harris rows to share the same truncated application_link, leading to
    // duplicate detection and role flipping (Software Engineering ↔ Software Engineer) for the same id.
    let applicationLink: string | undefined;
    const lastOpen = tds[3].lastIndexOf("](");
    const lastClose = tds[3].lastIndexOf(")");
    if (lastOpen !== -1 && lastClose > lastOpen + 1) {
      applicationLink = tds[3].slice(lastOpen + 2, lastClose).trim();
      // Guard against capturing the badge URL instead of the job URL when the cell is [![Apply](badge)](jobUrl)
      // The job URL should not be the badge (img.shields.io). If it is, fallback to regex.
      if (applicationLink.includes("img.shields.io")) {
        const links = [...tds[3].matchAll(/\]\(([^)]+)\)/g)];
        // Find the last non-badge link
        for (let i = links.length - 1; i >= 0; i--) {
          const candidate = links[i][1]?.trim();
          if (candidate && !candidate.includes("img.shields.io")) {
            applicationLink = candidate;
            break;
          }
        }
      }
    } else {
      const links = [...tds[3].matchAll(/\]\(([^)]+)\)/g)];
      applicationLink = links.at(-1)?.[1]?.trim();
      // Skip badge if it's the only match
      if (applicationLink?.includes("img.shields.io") && links.length > 1) {
        applicationLink = links[links.length - 2]?.[1]?.trim();
      }
    }
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
