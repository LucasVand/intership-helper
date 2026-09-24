import { describe, it, expect } from "vitest";
import { normalizeApplicationLink } from "../scripts/normalize-url";

describe("normalizeApplicationLink", () => {
  it("trims whitespace", () => {
    expect(normalizeApplicationLink("  https://example.com/job  ")).toBe("https://example.com/job");
  });

  it("lowercases protocol and hostname", () => {
    expect(normalizeApplicationLink("HTTPS://EXAMPLE.COM/Job")).toBe("https://example.com/Job");
    expect(normalizeApplicationLink("hTTp://Example.COM/path")).toBe("http://example.com/path");
  });

  it("strips default ports", () => {
    expect(normalizeApplicationLink("https://example.com:443/path")).toBe("https://example.com/path");
    expect(normalizeApplicationLink("http://example.com:80/path")).toBe("http://example.com/path");
    // non-default port kept
    expect(normalizeApplicationLink("https://example.com:8080/path")).toBe("https://example.com:8080/path");
    expect(normalizeApplicationLink("http://example.com:3000/path")).toBe("http://example.com:3000/path");
  });

  it("strips trailing slashes from pathname", () => {
    expect(normalizeApplicationLink("https://example.com/job/")).toBe("https://example.com/job");
    expect(normalizeApplicationLink("https://example.com/job///")).toBe("https://example.com/job");
    expect(normalizeApplicationLink("https://example.com///")).toBe("https://example.com/");
    expect(normalizeApplicationLink("https://example.com")).toBe("https://example.com/");
  });

  it("strips hash", () => {
    expect(normalizeApplicationLink("https://example.com/job#apply")).toBe("https://example.com/job");
    expect(normalizeApplicationLink("https://example.com/job#section-1")).toBe("https://example.com/job");
    expect(normalizeApplicationLink("https://example.com/job?ref=1#hash")).toBe("https://example.com/job?ref=1");
  });

  it("removes utm_* tracking params", () => {
    expect(normalizeApplicationLink("https://example.com/job?utm_source=Simplify&ref=Simplify")).toBe("https://example.com/job?ref=Simplify");
    expect(normalizeApplicationLink("https://example.com/job?utm_medium=company&utm_source=GHList&ref=x")).toBe("https://example.com/job?ref=x");
    expect(normalizeApplicationLink("https://example.com/job?UTM_SOURCE=gh&UTM_MEDIUM=1&keep=1")).toBe("https://example.com/job?keep=1");
  });

  it("removes other tracking params case-insensitive", () => {
    const url = "https://example.com/job?fbclid=123&gclid=abc&dclid=1&msclkid=2&igshid=3&yclid=4&mc_cid=5&mc_eid=6&_ga=1&_gl=2&keep=1";
    expect(normalizeApplicationLink(url)).toBe("https://example.com/job?keep=1");
    // case insensitive
    expect(normalizeApplicationLink("https://example.com/job?FBCLID=1&keep=1")).toBe("https://example.com/job?keep=1");
    expect(normalizeApplicationLink("https://example.com/job?GCLID=1&keep=1")).toBe("https://example.com/job?keep=1");
  });

  it("preserves non-tracking params like id, job, ref, source", () => {
    const url = "https://example.com/job?id=123&job=456&ref=Simplify&source=gh&keep=1";
    expect(normalizeApplicationLink(url)).toBe("https://example.com/job?id=123&job=456&keep=1&ref=Simplify&source=gh");
  });

  it("sorts remaining params alphabetically", () => {
    expect(normalizeApplicationLink("https://example.com/job?z=1&a=2&ref=3")).toBe("https://example.com/job?a=2&ref=3&z=1");
    expect(normalizeApplicationLink("https://example.com/job?ref=Simplify&gh_jid=123")).toBe("https://example.com/job?gh_jid=123&ref=Simplify");
  });

  it("handles URL with no params", () => {
    expect(normalizeApplicationLink("https://example.com/job")).toBe("https://example.com/job");
  });

  it("handles URL with only tracking params -> strips all", () => {
    expect(normalizeApplicationLink("https://example.com/job?utm_source=Simplify&utm_medium=company")).toBe("https://example.com/job");
  });

  it("fallback for invalid URL returns trimmed without hash", () => {
    expect(normalizeApplicationLink("not a url#hash")).toBe("not a url");
    expect(normalizeApplicationLink("  just-a-string ")).toBe("just-a-string");
    expect(normalizeApplicationLink("https://[invalid")).toBe("https://[invalid");
  });

  it("handles simplify job board URLs with multiple params", () => {
    // real simplify example
    const input = "https://careers.withwaymo.com/jobs?gh_jid=8224729&utm_source=Simplify&ref=Simplify";
    expect(normalizeApplicationLink(input)).toBe("https://careers.withwaymo.com/jobs?gh_jid=8224729&ref=Simplify");
  });

  it("handles greenhouse URLs with utm and ref", () => {
    const input = "https://job-boards.greenhouse.io/mercury/jobs/6199367004?utm_source=Simplify&ref=Simplify";
    // greenhouse link has no search initially, but utm added would be stripped
    expect(normalizeApplicationLink("https://job-boards.greenhouse.io/mercury/jobs/6199367004?utm_source=Simplify")).toBe("https://job-boards.greenhouse.io/mercury/jobs/6199367004");
  });

  it("ensures idempotence - normalizing twice gives same result", () => {
    const url = "https://EXAMPLE.COM:443/Job/?utm_source=x&ref=1#hash";
    const once = normalizeApplicationLink(url);
    const twice = normalizeApplicationLink(once);
    expect(once).toBe(twice);
  });
});
