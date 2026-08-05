/**
 * siteIdentity — THE canonical-origin resolver (g-b83d1c77 domain prep).
 *
 * One resolution rule, used by layout metadataBase, sitemap, and robots so
 * the canonical domain is a single env-var decision, never a scatter of
 * literals:
 *   1. NEXT_PUBLIC_SITE_URL — the explicit canonical (set this to
 *      https://next-bar.com when the domain goes live; next-bar.app is
 *      STALE and must never be used);
 *   2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL — honest deployment
 *      identity until then;
 *   3. localhost dev fallback.
 *
 * Every candidate is normalized to its URL ORIGIN (santa: Codex, g-b83d1c77
 * panel): a trailing slash in the env var would otherwise leak double-slash
 * URLs into the sitemap, a blank value would beat the fallbacks, and an
 * unparseable value would explode later inside `new URL(siteUrl)` in the
 * root layout.
 *
 * Server-side only at build/request time (env access); client code keeps
 * using window.location.origin, which is always the truthful origin.
 */
export function resolveSiteUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const candidates = [
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  ];
  for (const candidate of candidates) {
    const value = (candidate ?? '').trim();
    if (value === '') continue;
    try {
      const url = new URL(value);
      // http(s) with a REAL origin only: opaque schemes (mailto:, data:)
      // parse fine but their origin is the literal string "null", which
      // would poison metadataBase and every sitemap URL (santa: Codex,
      // round 2).
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.origin === 'null') continue;
      return url.origin;
    } catch {
      continue; // unparseable config falls through, never propagates
    }
  }
  return 'http://localhost:3000';
}

/**
 * True only for an origin fit to advertise to crawlers: https and not a
 * loopback. robots.ts refuses to serve production crawl rules against
 * anything else — a misconfigured prod env must fail CLOSED, not invite
 * indexing of localhost URLs (santa: Codex, g-b83d1c77 panel).
 */
export function isPublicOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    // Loopback, link-local, RFC1918 private, unspecified, and .localhost /
    // .local names are all non-public — two exact names was not actually
    // fail-closed (`https://[::1]`, `https://127.0.0.2` slipped through;
    // santa: Codex, round 2).
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '0.0.0.0' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      // CGNAT (RFC 6598) — not publicly routable either.
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      // IPv6 non-public forms (santa: Codex, round 3): loopback,
      // unspecified, ULA fc00::/7, link-local fe80::/10, and IPv4-mapped
      // (which smuggles the v4 ranges past the v4 regexes above).
      host === '[::1]' ||
      host === '[::]' ||
      /^\[f[cd]/.test(host) ||
      /^\[fe[89ab]/.test(host) ||
      host.startsWith('[::ffff:')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
