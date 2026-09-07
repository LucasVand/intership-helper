import fetch from "node-fetch";
import type { InternshipSourceAdapter, ScrapedInternship } from "./types";

const URL = "https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/main/README.md";

function parsePostedAt(value: string): Date | undefined {
  const match = value.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return undefined;
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function fetchAndParse(): Promise<ScrapedInternship[]> {
  const res = await fetch(URL, { headers: { "User-Agent": "node.js" } });
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status} ${res.statusText}`);
  const markdown = await res.text();
  const result: ScrapedInternship[] = [];
  let lastCompany = "";

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const tds = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (tds.length < 5 || /^-+$/.test(tds[0])) continue;
    const rawCompany = tds[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    const company = rawCompany === "↳" ? lastCompany : rawCompany;
    const role = tds[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    const location = tds[2].trim();
    const links = [...tds[3].matchAll(/\]\(([^)]+)\)/g)];
    const applicationLink = links.at(-1)?.[1]?.trim();
    if (!company || !role || !applicationLink || /^company$/i.test(company)) continue;
    if (rawCompany !== "↳") lastCompany = company;
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

export const canadianTechSource: InternshipSourceAdapter = { source: "canadian-tech", url: URL, fetchAndParse };
