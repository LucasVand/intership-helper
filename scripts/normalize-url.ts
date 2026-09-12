// Only remove parameters whose names are unambiguously tracking metadata.
// Parameters such as `id`, `job`, `ref`, and `source` may be required by a
// job board, so unknown and ambiguous parameters are intentionally preserved.
const TRACKING_PARAMETER = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|igshid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;

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
