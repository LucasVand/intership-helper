import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanText, parsePostedAt, parseSimplifyHtml } from "../scripts/sources/simplify";

describe("cleanText (simplify)", () => {
  it("removes flags", () => {
    expect(cleanText("Waymo 🛂")).toBe("Waymo");
    expect(cleanText("Role 🔥 🎓")).toBe("Role");
    expect(cleanText("🔒 Closed")).toBe("Closed");
  });

  it("trims and collapses double spaces", () => {
    expect(cleanText("  Software  Engineer   Intern  ")).toBe("Software Engineer Intern");
  });
});

describe("parsePostedAt (simplify)", () => {
  it("parses 0d as now", () => {
    const before = Date.now();
    const d = parsePostedAt("0d");
    const after = Date.now();
    expect(d!.getTime()).toBeGreaterThanOrEqual(before);
    expect(d!.getTime()).toBeLessThanOrEqual(after);
  });

  it("parses days", () => {
    const d = parsePostedAt("2d");
    const diff = Date.now() - d!.getTime();
    expect(diff).toBeGreaterThan(1 * 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(3 * 24 * 60 * 60 * 1000);
  });

  it("parses hours", () => {
    const d = parsePostedAt("5h");
    const diff = Date.now() - d!.getTime();
    expect(diff).toBeGreaterThan(4 * 60 * 60 * 1000);
  });

  it("parses mins", () => {
    expect(parsePostedAt("30m")).toBeDefined();
    expect(parsePostedAt("30min")).toBeDefined();
    expect(parsePostedAt("30mins")).toBeDefined();
  });

  it("parses weeks", () => {
    const d = parsePostedAt("1w");
    const diff = Date.now() - d!.getTime();
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(parsePostedAt("2wk")).toBeDefined();
    expect(parsePostedAt("2wks")).toBeDefined();
  });

  it("parses months as 30 days", () => {
    const d = parsePostedAt("1mo");
    const diff = Date.now() - d!.getTime();
    expect(diff).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(parsePostedAt("1mos")).toBeDefined();
  });

  it("returns undefined for invalid", () => {
    expect(parsePostedAt("")).toBeUndefined();
    expect(parsePostedAt(undefined)).toBeUndefined();
    expect(parsePostedAt("invalid")).toBeUndefined();
    expect(parsePostedAt("Sep 21, 2026")).toBeUndefined();
  });

  it("case-insensitive", () => {
    expect(parsePostedAt("2D")).toBeDefined();
    expect(parsePostedAt("5H")).toBeDefined();
  });
});

describe("parseSimplifyHtml", () => {
  it("parses single table row with flags on company", () => {
    const html = `<table><thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th><th>Age</th></tr></thead><tbody>
<tr>
<td>🔥 <strong><a href="https://simplify.jobs/c/Waymo">Waymo</a></strong></td>
<td>Software Engineer Intern - MS/PhD 🎓</td>
<td>Mountain View, CA</td>
<td><div align="center"><a href="https://careers.withwaymo.com/jobs?gh_jid=8224729&utm_source=Simplify&ref=Simplify">Apply</a></div></td>
<td>0d</td>
</tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Waymo");
    expect(rows[0].role).toBe("Software Engineer Intern - MS/PhD");
    expect(rows[0].location).toBe("Mountain View, CA");
    expect(rows[0].applicationLink).toBe("https://careers.withwaymo.com/jobs?gh_jid=8224729&utm_source=Simplify&ref=Simplify");
    expect(rows[0].isFaang).toBe(true);
    expect(rows[0].requiresAdvancedDegree).toBe(true);
  });

  it("combines company and role flags", () => {
    const html = `<table><tbody>
<tr><td>🛂 Company</td><td>Role 🇺🇸</td><td>NYC</td><td><a href="https://example.com/job">Apply</a></td><td>1d</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows[0].noSponsorship).toBe(true);
    expect(rows[0].requiresCitizenship).toBe(true);
  });

  it("handles continuation row ↳", () => {
    const html = `<table><tbody>
<tr><td><strong><a>AMD</a></strong></td><td>AI Intern 🎓</td><td>Santa Clara, CA</td><td><a href="https://amd.com/jobs/1">Apply</a></td><td>0d</td></tr>
<tr><td>↳</td><td>Hardware AI Intern 🎓</td><td>Santa Clara, CA</td><td><a href="https://amd.com/jobs/2">Apply</a></td><td>0d</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows).toHaveLength(2);
    expect(rows[0].company).toBe("AMD");
    expect(rows[1].company).toBe("AMD");
    expect(rows[1].isFaang).toBe(false); // AMD row had 🔥? This sample no 🔥, so false. But continuation inherits lastFlags from AMD (no flag)
    // second role has 🎓, so requiresAdvancedDegree true via roleFlags
    expect(rows[1].requiresAdvancedDegree).toBe(true);
  });

  it("inherits flags correctly via lastFlags", () => {
    const html = `<table><tbody>
<tr><td>🔥 AMD</td><td>Role</td><td>CA</td><td><a href="https://example.com/1">Apply</a></td><td>0d</td></tr>
<tr><td>↳</td><td>Role2</td><td>CA</td><td><a href="https://example.com/2">Apply</a></td><td>0d</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows[0].isFaang).toBe(true);
    expect(rows[1].isFaang).toBe(true); // continuation inherits
  });

  it("skips rows without link", () => {
    const html = `<table><tbody>
<tr><td>Company</td><td>Role</td><td>NYC</td><td></td><td>0d</td></tr>
</tbody></table>`;
    expect(parseSimplifyHtml(html)).toHaveLength(0);
  });

  it("skips rows with missing company and role", () => {
    const html = `<table><tbody>
<tr><td></td><td></td><td>NYC</td><td><a href="https://example.com">Apply</a></td><td>0d</td></tr>
</tbody></table>`;
    expect(parseSimplifyHtml(html)).toHaveLength(0);
  });

  it("parses location with details (multiple locations)", () => {
    const html = `<table><tbody>
<tr><td>State Farm</td><td>Developer Intern</td><td><details><summary><strong>4 locations</strong></summary>Tempe, AZ<br>Dunwoody, GA<br>Richardson, TX</details></td><td><a href="https://example.com">Apply</a></td><td>0d</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows[0].location).toContain("Tempe, AZ");
    expect(rows[0].location).toContain("Dunwoody, GA");
  });

  it("picks first link when multiple Apply links (job + simplify)", () => {
    const html = `<table><tbody>
<tr><td>Company</td><td>Role</td><td>NYC</td><td><div><a href="https://job.com/123">Apply</a> <a href="https://simplify.jobs/p/123">Simplify</a></div></td><td>0d</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows[0].applicationLink).toBe("https://job.com/123");
  });

  it("handles multiple tables (6 categories) like live README", () => {
    const html = `<table><tbody><tr><td>A</td><td>R1</td><td>L1</td><td><a href="https://a.com/1">Apply</a></td><td>0d</td></tr></tbody></table>
<table><tbody><tr><td>B</td><td>R2</td><td>L2</td><td><a href="https://b.com/2">Apply</a></td><td>1d</td></tr></tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.company)).toEqual(["A", "B"]);
  });

  it("parses age correctly", () => {
    const html = `<table><tbody>
<tr><td>C</td><td>R</td><td>L</td><td><a href="https://example.com">Apply</a></td><td>5mo</td></tr>
</tbody></table>`;
    const rows = parseSimplifyHtml(html);
    expect(rows[0].postedAt).toBeInstanceOf(Date);
  });
});
