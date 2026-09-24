import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeKey,
  getDatabaseUrl,
  formatFlag,
  flagLabel,
  getLogFilePath,
  buildLogPayload,
  buildDetails,
  findDuplicateRows,
  computeNewEntries,
  computeToUpdate,
} from "../scripts/sync-internships";
import type { ScrapedInternship } from "../scripts/sources/types";

describe("getDatabaseUrl", () => {
  const origEnv = process.env;
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
  });
  afterEach(() => {
    process.env = origEnv;
  });

  it("returns DATABASE_URL if set", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost/db";
    expect(getDatabaseUrl()).toBe("postgresql://user:pass@localhost/db");
  });

  it("builds from POSTGRES_*", () => {
    process.env.POSTGRES_USER = "postgres";
    process.env.POSTGRES_PASSWORD = "p@ss:word";
    process.env.POSTGRES_DB = "mydb";
    expect(getDatabaseUrl()).toBe("postgresql://postgres:p%40ss%3Aword@db:5432/mydb");
  });

  it("uses host/port overrides", () => {
    process.env.POSTGRES_USER = "u";
    process.env.POSTGRES_PASSWORD = "p";
    process.env.POSTGRES_DB = "d";
    process.env.POSTGRES_HOST = "myhost";
    process.env.POSTGRES_PORT = "9999";
    expect(getDatabaseUrl()).toBe("postgresql://u:p@myhost:9999/d");
  });

  it("returns undefined if missing parts", () => {
    process.env.POSTGRES_USER = "u";
    expect(getDatabaseUrl()).toBeUndefined();
    process.env.POSTGRES_USER = "u";
    process.env.POSTGRES_PASSWORD = "p";
    expect(getDatabaseUrl()).toBeUndefined();
  });
});

describe("makeKey", () => {
  it("normalizes via normalizeApplicationLink", () => {
    expect(makeKey({ applicationLink: "HTTPS://EXAMPLE.COM:443/job/?utm_source=Simplify&ref=1#hash" })).toBe(
      "https://example.com/job?ref=1"
    );
  });

  it("handles ScrapedInternship with other fields", () => {
    const r: ScrapedInternship = {
      source: "simplify",
      company: "A",
      role: "R",
      location: "NYC",
      applicationLink: "https://example.com/job?utm_source=x",
    };
    expect(makeKey(r)).toBe("https://example.com/job");
  });
});

describe("formatFlag / flagLabel", () => {
  it("formatFlag", () => {
    expect(formatFlag(true)).toBe("true");
    expect(formatFlag(false)).toBe("false");
    expect(formatFlag(undefined)).toBe("false");
  });

  it("flagLabel includes emoji", () => {
    expect(flagLabel("isFaang", false, true)).toBe("isFaang 🔥: false→true");
    expect(flagLabel("noSponsorship", true, false)).toBe("noSponsorship 🛂: true→false");
    expect(flagLabel("isClosed", false, false)).toBe("isClosed 🔒: false→false");
  });
});

describe("getLogFilePath", () => {
  const origEnv = process.env;
  afterEach(() => {
    process.env = origEnv;
    delete process.env.SYNC_LOG_FILE;
  });

  it("returns SYNC_LOG_FILE env if no flag", () => {
    process.env.SYNC_LOG_FILE = "logs/env.json";
    expect(getLogFilePath([])).toBe("logs/env.json");
  });

  it("returns null if no flag and no env", () => {
    delete process.env.SYNC_LOG_FILE;
    expect(getLogFilePath([])).toBeNull();
  });

  it("handles --log-file without value", () => {
    expect(getLogFilePath(["--log-file"])).toMatch(/^logs\/sync-/);
  });

  it("handles --log-file=PATH", () => {
    expect(getLogFilePath(["--log-file=./logs/custom.json"])).toBe("./logs/custom.json");
    expect(getLogFilePath(["--log-file="])).toBeNull(); // empty after = fallback to env? code returns flag.slice(eqIdx+1) || null -> null
  });

  it("prefers flag over env", () => {
    process.env.SYNC_LOG_FILE = "logs/env.json";
    expect(getLogFilePath(["--log-file=logs/flag.json"])).toBe("logs/flag.json");
  });
});

describe("buildLogPayload", () => {
  it("builds inserted and updated structure", () => {
    const newEntries: ScrapedInternship[] = [
      {
        source: "canadian-tech",
        company: "Mercury",
        role: "Intern",
        location: "Remote",
        applicationLink: "https://example.com/1",
        postedAt: new Date("2026-09-21T00:00:00Z"),
        isFaang: true,
      },
    ];
    const toUpdate = [
      {
        id: 5,
        flags: {
          source: "simplify" as const,
          company: "Waymo",
          role: "Engineer",
          location: "CA",
          applicationLink: "https://example.com/2",
          postedAt: new Date("2026-09-20T00:00:00Z"),
          isClosed: true,
        },
        cleanCompany: "Waymo",
        cleanRole: "Engineer",
        source: "simplify",
        reasons: ["isClosed 🔒: false→true"],
        existing: {
          company: "Waymo",
          role: "Engineer",
          location: "CA",
          source: "simplify",
          postedAt: new Date("2026-09-19T00:00:00Z"),
          noSponsorship: false,
          requiresCitizenship: false,
          isClosed: false,
          isFaang: false,
          requiresAdvancedDegree: false,
        },
      },
    ];
    const payload = buildLogPayload(newEntries as any, toUpdate as any, {
      scrapedCount: 10,
      existingCount: 5,
      totalAfter: 6,
      durationMs: 100,
      status: "success",
      dryRun: false,
    });
    expect(payload.meta.scrapedCount).toBe(10);
    expect(payload.inserted[0].company).toBe("Mercury");
    expect(payload.inserted[0].flags.isFaang).toBe(true);
    expect(payload.updated[0].reasons).toContain("isClosed 🔒: false→true");
    expect(payload.generatedAt).toBeDefined();
  });
});

describe("findDuplicateRows", () => {
  it("detects duplicates via normalized link (utm stripped)", () => {
    const existing = [
      { id: 1, applicationLink: "https://example.com/job?utm_source=Simplify&ref=1", company: "A" },
      { id: 2, applicationLink: "https://example.com/job?ref=1", company: "A" },
      { id: 3, applicationLink: "https://example.com/other", company: "B" },
    ] as any;
    const { existingMap, duplicateRows } = findDuplicateRows(existing);
    expect(duplicateRows).toHaveLength(1);
    expect(duplicateRows[0].duplicate.id).toBe(2);
    expect(duplicateRows[0].survivor.id).toBe(1);
    expect(existingMap.size).toBe(2); // job -> survivor, other
  });

  it("handles case and trailing slash normalization", () => {
    const existing = [
      { id: 1, applicationLink: "https://EXAMPLE.COM/job/" },
      { id: 2, applicationLink: "https://example.com/job" },
    ] as any;
    const { duplicateRows } = findDuplicateRows(existing);
    expect(duplicateRows).toHaveLength(1);
  });

  it("no duplicates returns empty", () => {
    const existing = [
      { id: 1, applicationLink: "https://example.com/1" },
      { id: 2, applicationLink: "https://example.com/2" },
    ] as any;
    const { duplicateRows, existingMap } = findDuplicateRows(existing);
    expect(duplicateRows).toHaveLength(0);
    expect(existingMap.size).toBe(2);
  });
});

describe("computeNewEntries", () => {
  const existingMap = new Map<string, any>([
    ["https://example.com/existing?ref=1", { id: 1, applicationLink: "https://example.com/existing?ref=1" }],
  ]);

  it("filters existing links", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "A", role: "R1", location: "NYC", applicationLink: "https://example.com/existing?ref=1" },
      { source: "simplify", company: "B", role: "R2", location: "NYC", applicationLink: "https://example.com/new" },
    ];
    const result = computeNewEntries(scraped, existingMap);
    expect(result).toHaveLength(1);
    expect(result[0].company).toBe("B");
  });

  it("filters duplicate scraped links via seenScrapedLinks (deduplicates within batch)", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "A", role: "R1", location: "NYC", applicationLink: "https://example.com/dup" },
      { source: "canadian-tech", company: "B", role: "R2", location: "NYC", applicationLink: "https://example.com/dup" },
    ];
    const result = computeNewEntries(scraped, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].company).toBe("A");
  });

  it("normalizes tracking params for dedup (utm stripped)", () => {
    const map = new Map<string, any>([["https://example.com/job?ref=1", { id: 1 }]]);
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "A", role: "R", location: "NYC", applicationLink: "https://example.com/job?utm_source=Simplify&ref=1" },
    ];
    const result = computeNewEntries(scraped, map);
    expect(result).toHaveLength(0); // considered existing after normalization
  });

  it("skips empty link", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "A", role: "R", location: "NYC", applicationLink: "" },
      { source: "simplify", company: "B", role: "R", location: "NYC", applicationLink: "   " },
    ];
    expect(computeNewEntries(scraped, new Map())).toHaveLength(0);
  });

  it("returns empty when all are existing", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "A", role: "R", location: "NYC", applicationLink: "https://example.com/existing?ref=1" },
    ];
    expect(computeNewEntries(scraped, existingMap)).toHaveLength(0);
  });
});

describe("computeToUpdate", () => {
  const baseExisting = new Map<string, any>([
    [
      "https://example.com/job?ref=1",
      {
        id: 10,
        applicationLink: "https://example.com/job?ref=1",
        company: "Waymo",
        role: "Engineer",
        source: "simplify",
        postedAt: new Date("2026-09-01T00:00:00Z"),
        noSponsorship: false,
        requiresCitizenship: false,
        isClosed: false,
        isFaang: false,
        requiresAdvancedDegree: false,
        location: "CA",
      },
    ],
  ]);

  it("detects no change -> empty", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
        postedAt: new Date("2026-09-01T05:00:00Z"), // <12h diff
      },
    ];
    expect(computeToUpdate(scraped, baseExisting)).toHaveLength(0);
  });

  it("detects applicationLink normalization change (utm stripped)", () => {
    // DB has raw with utm, scraped normalized will differ from DB raw, but key is normalized -> should trigger applicationLink reason
    const existingWithUtm = new Map<string, any>([
      [
        "https://example.com/job?ref=1",
        {
          id: 10,
          applicationLink: "https://example.com/job?utm_source=Simplify&ref=1", // raw with utm
          company: "Waymo",
          role: "Engineer",
          source: "simplify",
          postedAt: new Date("2026-09-01T00:00:00Z"),
          noSponsorship: false,
          requiresCitizenship: false,
          isClosed: false,
          isFaang: false,
          requiresAdvancedDegree: false,
          location: "CA",
        },
      ],
    ]);
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?utm_source=Simplify&ref=1", // will be normalized to ?ref=1 in makeKey
      },
    ];
    // makeKey for scraped normalizes, so key = https://example.com/job?ref=1 which matches map key, but ex.applicationLink !== key triggers reason
    const result = computeToUpdate(scraped, existingWithUtm);
    expect(result).toHaveLength(1);
    expect(result[0].reasons.join()).toContain("applicationLink");
  });

  it("detects flag changes", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
        isFaang: true, // changed
      },
    ];
    const result = computeToUpdate(scraped, baseExisting);
    expect(result[0].reasons.join()).toContain("isFaang");
  });

  it("detects company/role change", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo Updated",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
      },
    ];
    const result = computeToUpdate(scraped, baseExisting);
    expect(result[0].reasons.join()).toContain('company: "Waymo" → "Waymo Updated"');
  });

  it("merges source to multiple when differing", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "canadian-tech",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
      },
    ];
    const result = computeToUpdate(scraped, baseExisting);
    expect(result[0].source).toBe("multiple");
    expect(result[0].reasons.join()).toContain("source: simplify → multiple");
  });

  it("keeps source if same or already multiple", () => {
    const scrapedSame: ScrapedInternship[] = [
      { source: "simplify", company: "Waymo", role: "Engineer", location: "CA", applicationLink: "https://example.com/job?ref=1" },
    ];
    expect(computeToUpdate(scrapedSame, baseExisting)).toHaveLength(0); // no other change

    const existingMultiple = new Map<string, any>([
      [
        "https://example.com/job?ref=1",
        {
          id: 10,
          applicationLink: "https://example.com/job?ref=1",
          company: "Waymo",
          role: "Engineer",
          source: "multiple",
          postedAt: new Date("2026-09-01T00:00:00Z"),
          noSponsorship: false,
          requiresCitizenship: false,
          isClosed: false,
          isFaang: false,
          requiresAdvancedDegree: false,
          location: "CA",
        },
      ],
    ]);
    const scrapedMultiple: ScrapedInternship[] = [
      { source: "canadian-tech", company: "Waymo", role: "Engineer", location: "CA", applicationLink: "https://example.com/job?ref=1" },
    ];
    // source multiple already, so no change even though scraped is canadian-tech
    const result = computeToUpdate(scrapedMultiple, existingMultiple);
    expect(result).toHaveLength(0);
  });

  it("detects postedAt null -> now dated", () => {
    const existingNullDate = new Map<string, any>([
      [
        "https://example.com/job?ref=1",
        {
          id: 10,
          applicationLink: "https://example.com/job?ref=1",
          company: "Waymo",
          role: "Engineer",
          source: "simplify",
          postedAt: null,
          noSponsorship: false,
          requiresCitizenship: false,
          isClosed: false,
          isFaang: false,
          requiresAdvancedDegree: false,
          location: "CA",
        },
      ],
    ]);
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
        postedAt: new Date("2026-09-21T00:00:00Z"),
      },
    ];
    const result = computeToUpdate(scraped, existingNullDate);
    expect(result[0].reasons.join()).toContain("postedAt: null →");
  });

  it("detects postedAt drift >12h", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
        postedAt: new Date("2026-09-10T00:00:00Z"), // 9 days diff
      },
    ];
    const result = computeToUpdate(scraped, baseExisting);
    expect(result[0].reasons.join()).toContain("postedAt:");
  });

  it("ignores postedAt drift <12h", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "CA",
        applicationLink: "https://example.com/job?ref=1",
        postedAt: new Date("2026-09-01T06:00:00Z"), // 6h diff
      },
    ];
    expect(computeToUpdate(scraped, baseExisting)).toHaveLength(0);
  });

  it("ignores location drift (not triggering update)", () => {
    const scraped: ScrapedInternship[] = [
      {
        source: "simplify",
        company: "Waymo",
        role: "Engineer",
        location: "NYC", // different from CA
        applicationLink: "https://example.com/job?ref=1",
      },
    ];
    // location changed but no other reason -> should be empty (location drift logged but not reason)
    expect(computeToUpdate(scraped, baseExisting)).toHaveLength(0);
  });

  it("skips scraped with empty link", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "Waymo", role: "Engineer", location: "CA", applicationLink: "" },
    ];
    expect(computeToUpdate(scraped, baseExisting)).toHaveLength(0);
  });

  it("skips scraped not in existingMap", () => {
    const scraped: ScrapedInternship[] = [
      { source: "simplify", company: "Unknown", role: "R", location: "NYC", applicationLink: "https://example.com/not-exist" },
    ];
    expect(computeToUpdate(scraped, baseExisting)).toHaveLength(0);
  });
});

describe("buildDetails", () => {
  it("computes per-source inserted/updated and reason counts", () => {
    const perSourceScraped = { simplify: 10, "canadian-tech": 5 };
    const newEntries = [
      { source: "simplify", company: "A", role: "R", location: "NYC", applicationLink: "https://a.com" },
      { source: "simplify", company: "B", role: "R", location: "NYC", applicationLink: "https://b.com" },
      { source: "canadian-tech", company: "C", role: "R", location: "TOR", applicationLink: "https://c.com" },
    ] as any;
    const toUpdate = [
      { flags: { source: "simplify" }, reasons: ['applicationLink: "a" → "b"', "isFaang 🔥: false→true"] },
      { flags: { source: "simplify" }, reasons: ["isFaang 🔥: false→true"] },
      { flags: { source: "canadian-tech" }, reasons: ['role: "Old" → "New"'] },
    ] as any;
    const details = buildDetails(perSourceScraped, newEntries, toUpdate);
    expect(details.perSource).toEqual({
      simplify: { scraped: 10, inserted: 2, updated: 2 },
      "canadian-tech": { scraped: 5, inserted: 1, updated: 1 },
    });
    // reasonCounts splits on ":" then first word
    expect(details.reasonCounts["applicationLink"]).toBe(1);
    expect(details.reasonCounts["isFaang"]).toBe(2);
    expect(details.reasonCounts["role"]).toBe(1);
    expect(details.insertedSample).toHaveLength(3);
    expect(details.updatedSample).toHaveLength(3);
  });

  it("handles empty inputs", () => {
    const details = buildDetails({}, [], []);
    expect(details.perSource).toEqual({});
    expect(details.reasonCounts).toEqual({});
    expect(details.insertedSample).toEqual([]);
    expect(details.updatedSample).toEqual([]);
  });

  it("truncates samples to 5", () => {
    const perSourceScraped = { simplify: 10 };
    const newEntries = Array.from({ length: 10 }, (_, i) => ({
      source: "simplify",
      company: `C${i}`,
      role: "R",
      location: "NYC",
      applicationLink: `https://example.com/${i}`,
    })) as any;
    const details = buildDetails(perSourceScraped, newEntries, []);
    expect(details.insertedSample).toHaveLength(5);
    expect(details.insertedSample[0].company).toBe("C0");
  });
});
