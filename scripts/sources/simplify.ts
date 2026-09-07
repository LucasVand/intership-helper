import fetch from "node-fetch";
import * as cheerio from "cheerio";
import type { InternshipSourceAdapter, ScrapedInternship } from "./types";

const URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md";

function cleanText(text: string): string {
  return text
    .replace(/🛂|🇺🇸|🔒|🔥|🎓/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

function parsePostedAt(age?: string): Date | undefined {
  if (!age) return undefined;
  const match = age.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|mo|mos)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  const minutes =
    unit === "m" || unit === "min" || unit === "mins" ? value :
    unit === "h" || unit === "hr" || unit === "hrs" ? value * 60 :
    unit === "w" || unit === "wk" || unit === "wks" ? value * 7 * 24 * 60 :
    unit === "mo" || unit === "mos" ? value * 30 * 24 * 60 :
    value * 24 * 60;
  return new Date(Date.now() - minutes * 60 * 1000);
}

async function fetchAndParse(): Promise<ScrapedInternship[]> {
  const res = await fetch(URL, { headers: { "User-Agent": "node.js" } });
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status} ${res.statusText}`);
  const $ = cheerio.load(await res.text());
  const result: ScrapedInternship[] = [];
  let lastCompany = "";
  let lastFlags = { noSponsorship: false, requiresCitizenship: false, isClosed: false, isFaang: false, requiresAdvancedDegree: false };

  $("table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    const companyCell = $(tds.get(0));
    const rawCompany = companyCell.text().trim();
    const companyText = companyCell.find("a").first().text().trim() || rawCompany;
    const continuation = /^↳/.test(rawCompany) || /^↳/.test(companyText) || rawCompany === "↳";
    let company: string;
    let companyFlags = lastFlags;
    if (continuation) company = lastCompany;
    else {
      companyFlags = {
        noSponsorship: rawCompany.includes("🛂"),
        requiresCitizenship: rawCompany.includes("🇺🇸"),
        isClosed: rawCompany.includes("🔒"),
        isFaang: rawCompany.includes("🔥"),
        requiresAdvancedDegree: rawCompany.includes("🎓"),
      };
      company = cleanText(companyText);
      if (company) {
        lastCompany = company;
        lastFlags = companyFlags;
      }
    }
    const roleRaw = $(tds.get(1)).text().trim();
    const role = cleanText(roleRaw);
    const links = $(tds.get(3)).find("a").map((__, a) => $(a).attr("href")?.trim()).get().filter(Boolean) as string[];
    if (!company || !role || !links[0]) return;
    const roleFlags = {
      noSponsorship: roleRaw.includes("🛂"),
      requiresCitizenship: roleRaw.includes("🇺🇸"),
      isClosed: roleRaw.includes("🔒"),
      isFaang: roleRaw.includes("🔥"),
      requiresAdvancedDegree: roleRaw.includes("🎓"),
    };
    result.push({
      source: "simplify",
      company,
      role,
      location: $(tds.get(2)).text().replace(/\n+/g, ", ").replace(/\s+,/g, ",").trim(),
      applicationLink: links[0],
      postedAt: parsePostedAt(tds.length >= 5 ? $(tds.get(4)).text().trim() : undefined),
      noSponsorship: companyFlags.noSponsorship || roleFlags.noSponsorship,
      requiresCitizenship: companyFlags.requiresCitizenship || roleFlags.requiresCitizenship,
      isClosed: companyFlags.isClosed || roleFlags.isClosed,
      isFaang: companyFlags.isFaang || roleFlags.isFaang,
      requiresAdvancedDegree: companyFlags.requiresAdvancedDegree || roleFlags.requiresAdvancedDegree,
    });
  });
  return result;
}

export const simplifySource: InternshipSourceAdapter = { source: "simplify", url: URL, fetchAndParse };
