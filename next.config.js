/**
 * Application-owned browser security headers (Item 9).
 *
 * WHY HERE AND NOT IN MIDDLEWARE. `src/middleware.ts` matches only
 * `/auth/:path*` and `/settings/:path*`, and that narrow matcher is a
 * deliberate security fix: the middleware calls `supabase.auth.getUser()`
 * unconditionally, so every path it covers turns a forged auth cookie into an
 * outbound Supabase call (C2 audit F1b removed `/api/:path*` for exactly that
 * reason). Widening the matcher to cover every route just to attach static
 * headers would re-introduce that amplification lever on the whole site.
 * `headers()` is evaluated by the framework without running middleware, so it
 * adds the headers at zero request cost.
 *
 * Each CSP source below exists because something real needs it:
 *  - maps.googleapis.com — the Places/Maps JS API, injected at runtime by
 *    `src/lib/placesUiKit.ts`.
 *  - maps.gstatic.com / *.gstatic.com / *.ggpht.com — map tiles, sprites and
 *    Place photo bytes served by that API.
 *  - www.google.com — the Maps EMBED iframe, hence `frame-src`.
 *  - *.basemaps.cartocdn.com — the Leaflet dark basemap TILES used by
 *    `BarMap` and `NeighborhoodMapPicker`. This one was missed on the first
 *    pass and caught by the e2e smoke run, which is the whole reason the CSP
 *    ships Report-Only: an enforcing policy would have blanked both maps.
 *  - *.supabase.co over both https and wss — auth, REST and realtime. The
 *    project subdomain comes from an env var, so it is matched by wildcard
 *    rather than pinned.
 *
 *  - places.googleapis.com — the PLACES UI KIT. `GooglePlacePhoto` creates
 *    `<gmp-place-details-compact>` / `<gmp-place-media>` web components and
 *    those fetch place data and photo bytes from Google at runtime, from the
 *    BROWSER. Easy to miss, because every `places.googleapis.com` reference
 *    in this repo is in a Node script (`scripts/refresh-places.mjs` and
 *    friends) which is server-side and never subject to CSP. Review caught
 *    the browser path.
 *  - *.googleusercontent.com — where Google Place photo media is commonly
 *    served from, alongside *.ggpht.com.
 *  - fonts.googleapis.com / fonts.gstatic.com — pulled by the Maps/Places
 *    components themselves. These are NOT for the app's own typeface:
 *    `next/font/google` in `src/app/layout.tsx` self-hosts Poppins at build
 *    time. An earlier draft of this policy removed both hosts on exactly that
 *    reasoning, which would have broken the Places UI Kit under enforcement.
 *  - 'unsafe-inline' / 'unsafe-eval' in script-src — required by Next.js's
 *    inline bootstrap and by the Maps loader. Removing them needs
 *    nonce-based CSP wired through the app shell; that is a follow-up, and
 *    pretending otherwise by shipping a policy that breaks the app would be
 *    worse than recording it.
 *
 * CSP SHIPS REPORT-ONLY. An enforcing policy that is even slightly wrong takes
 * the whole site down. Report-Only makes violations visible without breaking
 * Capacitor, Supabase or Maps. Every OTHER header below is enforced
 * immediately — none of them can break a working page.
 *
 * HOW THIS GETS PROMOTED, stated precisely because the first draft of this
 * comment was wrong. There is NO report-uri/report-to endpoint and no
 * collector, so violations appear only in a developer's own console — no
 * telemetry will ever arrive on its own. The promotion gate is therefore an
 * ATTENDED check, not passive data collection: flip the header key to
 * `Content-Security-Policy` locally, exercise the real flows (map, quiz,
 * venue photo, signup, auth) against a live Google key, and confirm a clean
 * console. The e2e smoke suite already fails on console errors, which is how
 * the missing cartocdn tile host below was caught. Adding a real report sink
 * is worthwhile but is a new API route and belongs to its own change.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.googleusercontent.com https://*.supabase.co https://*.basemaps.cartocdn.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://places.googleapis.com",
  "frame-src 'self' https://www.google.com",
  "worker-src 'self' blob:",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy-Report-Only', value: CSP_DIRECTIVES },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    // Geolocation IS used (the "bars near me" flow), so it stays enabled for
    // our own origin; the rest are denied outright.
    value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Build directory, overridable so two dev servers can run the SAME project
   * with DIFFERENT `NEXT_PUBLIC_*` values.
   *
   * `NEXT_PUBLIC_*` is inlined at COMPILE time, and every dev server started
   * in this directory shares `.next`. So the e2e google-live server (which
   * sets NEXT_PUBLIC_GOOGLE_MEDIA=1) was serving chunks the MAIN server had
   * already compiled with the flag OFF — the google-live card silently
   * degraded to the ordinary hero/glyph card and the widget host never
   * rendered. It presented as intermittent: whichever server compiled a
   * route first won, so the same suite passed or failed depending on
   * ordering and on whether `.next` was warm.
   *
   * Unset in normal development and in CI builds, so the default is
   * unchanged; playwright.config.ts sets it for the google-live server only.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  async redirects() {
    return [
      {
        // /discover was archived for the current product (goal g-12d33864).
        //
        // This lives here rather than as a `redirect('/map')` page component,
        // and the difference is not cosmetic. A page that calls redirect() gets
        // STATICALLY PRERENDERED (`○ /discover 144 B` in the build output) and
        // is served as 307 with **no Location header** — Next hands the browser
        // an HTML document that navigates itself. Measured directly against the
        // production server before this change:
        //
        //   status: 307   location: undefined   content-type: text/html
        //
        // A browser copes with that. curl, a crawler, a link checker, or
        // anything following redirects at the HTTP level does not — it sees a
        // 307 pointing nowhere. A config redirect is handled before rendering
        // and emits a real Location header, so the archive is honoured by every
        // client rather than only by browsers.
        //
        // 307 (temporary), not 308: the operator archived Discover "for the
        // current product", not forever, and a 308 is cached hard enough that
        // reviving the route later becomes a support problem. `permanent: false`
        // is that choice, and it is an open question flagged for the operator.
        source: '/discover',
        destination: '/map',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
