import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test for the security headers declared in `next.config.js`.
 *
 * It lives under `src/` because that is what the vitest `include` globs
 * collect, and it reaches back out to the config through `createRequire`
 * rather than duplicating the header list — a copy would pass forever while
 * the real config drifted, which is the exact failure mode this is meant to
 * prevent.
 */
const require_ = createRequire(import.meta.url);
const nextConfig = require_(
  path.resolve(process.cwd(), 'next.config.js'),
) as {
  headers: () => Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  >;
};

async function headerMap(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers();
  const all = rules.flatMap((rule) => rule.headers);
  return new Map(all.map((h) => [h.key.toLowerCase(), h.value]));
}

describe('next.config.js security headers', () => {
  it('applies to every path, not just a subset', async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
  });

  it('sets the standard hardening headers', async () => {
    const headers = await headerMap();
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('strict-transport-security')).toContain('max-age=');
    expect(headers.get('permissions-policy')).toBeDefined();
  });

  it('keeps geolocation available to our own origin — the app uses it', async () => {
    const headers = await headerMap();
    // A blanket `geolocation=()` would silently kill the "bars near me"
    // flow, which is the kind of breakage a headers change causes and tests
    // rarely notice.
    expect(headers.get('permissions-policy')).toContain('geolocation=(self)');
  });

  it('ships the CSP in REPORT-ONLY mode until violations are observed', async () => {
    const headers = await headerMap();
    expect(headers.has('content-security-policy-report-only')).toBe(true);
    // Enforcing mode is a deliberate follow-up. If someone promotes it, this
    // test should be updated consciously, not tripped over.
    expect(headers.has('content-security-policy')).toBe(false);
  });

  describe('CSP allows the integrations the app actually depends on', () => {
    const directive = async (name: string): Promise<string> => {
      const csp = (await headerMap()).get('content-security-policy-report-only');
      const found = (csp ?? '')
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));
      return found ?? '';
    };

    it('permits the Google Maps/Places JS API', async () => {
      expect(await directive('script-src')).toContain('https://maps.googleapis.com');
    });

    it('permits Supabase REST/auth AND realtime websockets', async () => {
      const connect = await directive('connect-src');
      expect(connect).toContain('https://*.supabase.co');
      expect(connect).toContain('wss://*.supabase.co');
    });

    it('permits the Places UI Kit data endpoint, not just the Maps loader', async () => {
      // <gmp-place-details-compact> fetches from places.googleapis.com in the
      // BROWSER. Every places.googleapis.com reference in this repo is in a
      // server-side Node script, which is why this host is easy to miss.
      expect(await directive('connect-src')).toContain(
        'https://places.googleapis.com',
      );
    });

    it('permits Google-hosted Place photo media', async () => {
      expect(await directive('img-src')).toContain(
        'https://*.googleusercontent.com',
      );
    });

    it('permits the webfonts the Maps/Places components pull themselves', async () => {
      // Not for the app typeface — next/font self-hosts Poppins. These exist
      // because the Google components load their own icons/fonts.
      expect(await directive('style-src')).toContain('https://fonts.googleapis.com');
      expect(await directive('font-src')).toContain('https://fonts.gstatic.com');
    });

    it('permits Google-served image bytes', async () => {
      const img = await directive('img-src');
      expect(img).toContain('https://*.googleapis.com');
      expect(img).toContain('https://*.ggpht.com');
    });

    it('permits the Leaflet basemap TILES both maps render', async () => {
      // Regression guard: this host was missing from the first draft of the
      // policy and only the e2e smoke run caught it. Under an enforcing CSP
      // its absence blanks /map and the neighborhood picker entirely.
      expect(await directive('img-src')).toContain(
        'https://*.basemaps.cartocdn.com',
      );
    });

    it('permits the Google Maps embed iframe', async () => {
      expect(await directive('frame-src')).toContain('https://www.google.com');
    });

    it('still locks down the dangerous directives', async () => {
      expect(await directive('object-src')).toContain("'none'");
      expect(await directive('frame-ancestors')).toContain("'none'");
      expect(await directive('base-uri')).toContain("'self'");
      expect(await directive('form-action')).toContain("'self'");
    });
  });
});
