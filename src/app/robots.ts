import type { MetadataRoute } from 'next';
import { resolveEnvironment } from '@/lib/environment';
import { isPublicOrigin, resolveSiteUrl } from '@/lib/siteIdentity';

/**
 * robots — env-aware (g-b83d1c77 domain prep): only PRODUCTION invites
 * crawlers. Staging/preview builds disallow everything so the staging
 * host never competes with the canonical domain in an index (Vercel's
 * own preview protection helps, but this is the explicit signal).
 * API and auth-callback routes stay out of crawlers everywhere.
 */
export default function robots(): MetadataRoute.Robots {
  const base = resolveSiteUrl();
  // BOTH gates fail closed: a production env var with a localhost/invalid
  // origin must not invite indexing (santa: Codex, g-b83d1c77 panel).
  if (resolveEnvironment(process.env) !== 'production' || !isPublicOrigin(base)) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/callback'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
