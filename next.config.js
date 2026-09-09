/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // V9-06: media capture is for THIS origin only. Inside the iPhone shell,
  // Capacitor's WKUIDelegate grants getUserMedia to any origin it is asked
  // about (WebViewDelegationHandler.swift:52-58, Capacitor 8.5.0), so the web
  // document has to be the thing that says no on behalf of anything embedded
  // in it: with camera=(self) no cross-origin frame can even ask, and the
  // microphone is never requested by this app at all. Applies to every route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
