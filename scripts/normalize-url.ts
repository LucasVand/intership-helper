// URL normalization removed per user request — store URLs exactly as scraped
// Previously stripped utm_*, lowercased host, sorted params, etc., but now just trim
export function normalizeApplicationLink(applicationLink: string): string {
  return applicationLink.trim();
}
