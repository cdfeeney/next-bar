/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
