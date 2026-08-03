import type { MetadataRoute } from 'next';
import { resolveSiteUrl } from '@/lib/siteIdentity';

/**
 * sitemap — public, crawlable marketing/legal surfaces only
 * (g-b83d1c77 domain prep). App surfaces behind local state (/rankings,
 * /nights, /friends…) and token/param routes (/share/[barId],
 * /u/[handle]…) are deliberately absent: they're either meaningless to a
 * crawler or reachable only via a capability URL.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = resolveSiteUrl();
  return [
    { url: `${base}/install`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/join`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
