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
      return new URL(value).origin;
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
    return (
      url.protocol === 'https:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    );
  } catch {
    return false;
  }
}
