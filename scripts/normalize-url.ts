const TRACKING_PARAMETER = /^(utm_|ref$|referrer$|source$|campaign$|medium$|term$|content$|fbclid$|gclid$)/i;

export function normalizeApplicationLink(applicationLink: string): string {
  const trimmed = applicationLink.trim();
  try {
    const url = new URL(trimmed);
    const params = [...url.searchParams.entries()]
      .filter(([name]) => !TRACKING_PARAMETER.test(name))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [name, value] of params) url.searchParams.append(name, value);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed.split("#", 1)[0];
  }
}
