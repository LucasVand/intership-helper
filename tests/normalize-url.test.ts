import { describe, it, expect } from "vitest";
import { normalizeApplicationLink } from "../scripts/normalize-url";

describe("normalizeApplicationLink (no normalization — just trim per user request)", () => {
  it("trims whitespace", () => {
    expect(normalizeApplicationLink("  https://example.com/job  ")).toBe("https://example.com/job");
  });

  it("does not lower case, strip utm, sort, or strip hash — just trim", () => {
    // previously this would lower case host and strip utm, now it should preserve exactly as trimmed
    expect(normalizeApplicationLink("HTTPS://EXAMPLE.COM/Job?utm_source=Simplify&ref=1#hash")).toBe(
      "HTTPS://EXAMPLE.COM/Job?utm_source=Simplify&ref=1#hash"
    );
  });

  it("preserves trailing slash", () => {
    expect(normalizeApplicationLink("https://example.com/job/")).toBe("https://example.com/job/");
  });

  it("preserves hash", () => {
    expect(normalizeApplicationLink("https://example.com/job#apply")).toBe("https://example.com/job#apply");
  });

  it("preserves utm and other params as-is", () => {
    expect(normalizeApplicationLink("https://example.com/job?utm_source=Simplify&ref=Simplify")).toBe(
      "https://example.com/job?utm_source=Simplify&ref=Simplify"
    );
  });

  it("handles invalid URL as trim only", () => {
    expect(normalizeApplicationLink("not a url#hash")).toBe("not a url#hash");
    expect(normalizeApplicationLink("  just-a-string ")).toBe("just-a-string");
  });

  it("is idempotent for trim", () => {
    const url = "https://EXAMPLE.COM:443/Job/?utm_source=x&ref=1#hash";
    const once = normalizeApplicationLink(url);
    const twice = normalizeApplicationLink(once);
    expect(once).toBe(twice);
    expect(once).toBe(url.trim());
  });
});
