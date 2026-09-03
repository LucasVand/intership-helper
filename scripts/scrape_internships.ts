import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { writeFile } from 'fs/promises';

const RAW_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md';
const OUT_PATH = 'internships.json';

type Internship = {
  company: string;
  role: string;
  location: string;
  application_links: string[];
  age?: string;
  no_sponsorship?: boolean;
  requires_citizenship?: boolean;
  is_closed?: boolean;
  is_faang?: boolean;
  requires_advanced_degree?: boolean;
};

async function fetchReadme(): Promise<string> {
  const res = await fetch(RAW_URL, { headers: { 'User-Agent': 'node.js' } });
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status} ${res.statusText}`);
  return await res.text();
}

function extractFlags(text: string) {
  return {
    noSponsorship: text.includes("🛂"),
    requiresCitizenship: text.includes("🇺🇸"),
    isClosed: text.includes("🔒"),
    isFaang: text.includes("🔥"),
    requiresAdvancedDegree: text.includes("🎓"),
  };
}

function cleanText(text: string): string {
  return text
    .replace(/🛂/g, "")
    .replace(/🇺🇸/g, "")
    .replace(/🔒/g, "")
    .replace(/🔥/g, "")
    .replace(/🎓/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

function parseReadme(mdOrHtml: string): Internship[] {
  const $ = cheerio.load(mdOrHtml);
  const rows = $("table tbody tr");
  const internships: Internship[] = [];
  let lastCompany = "";
  let lastFlags = { noSponsorship: false, requiresCitizenship: false, isClosed: false, isFaang: false, requiresAdvancedDegree: false };

  rows.each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length === 0) return;

    const companyCell = $(tds.get(0));
    const rawCompanyFull = companyCell.text().trim();
    const rawCompanyLink = companyCell.find("a").first().text().trim() || rawCompanyFull;
    const isContinuation = /^↳/.test(rawCompanyFull) || /^↳/.test(rawCompanyLink) || rawCompanyFull === "↳";

    let company: string;
    let companyFlags = { noSponsorship: false, requiresCitizenship: false, isClosed: false, isFaang: false, requiresAdvancedDegree: false };
    if (isContinuation) {
      company = lastCompany;
      companyFlags = lastFlags;
    } else {
      const flags = extractFlags(rawCompanyFull);
      companyFlags = flags;
      company = cleanText(rawCompanyLink || rawCompanyFull);
      if (company) {
        lastCompany = company;
        lastFlags = flags;
      }
    }

    const rawRole = $(tds.get(1)).text().trim();
    const roleFlags = extractFlags(rawRole);
    const role = cleanText(rawRole);
    const location = $(tds.get(2)).text().replace(/\n+/g, ", ").replace(/\s+,/g, ",").trim();

    const applicationLinks: string[] = [];
    if (tds.length >= 4) {
      $(tds.get(3)).find('a').each((idx, a) => {
        const href = $(a).attr('href');
        if (href) applicationLinks.push(href.trim());
      });
    }

    const age = tds.length >= 5 ? $(tds.get(4)).text().trim() : undefined;

    if (!company && !role) return;

    const flagsCombined = {
      no_sponsorship: companyFlags.noSponsorship || roleFlags.noSponsorship,
      requires_citizenship: companyFlags.requiresCitizenship || roleFlags.requiresCitizenship,
      is_closed: companyFlags.isClosed || roleFlags.isClosed,
      is_faang: companyFlags.isFaang || roleFlags.isFaang,
      requires_advanced_degree: companyFlags.requiresAdvancedDegree || roleFlags.requiresAdvancedDegree,
    };

    internships.push({
      company,
      role,
      location,
      application_links: applicationLinks,
      age,
      no_sponsorship: flagsCombined.no_sponsorship || undefined,
      requires_citizenship: flagsCombined.requires_citizenship || undefined,
      is_closed: flagsCombined.is_closed || undefined,
      is_faang: flagsCombined.is_faang || undefined,
      requires_advanced_degree: flagsCombined.requires_advanced_degree || undefined,
    });
  });

  return internships;
}

async function main() {
  console.log('Fetching README...');
  const readme = await fetchReadme();
  console.log('Parsing entries...');
  const internships = parseReadme(readme);
  console.log(`Found ${internships.length} internship rows. Writing ${OUT_PATH}...`);
  await writeFile(OUT_PATH, JSON.stringify(internships, null, 2), 'utf8');
  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
