import type { CapacitorConfig } from '@capacitor/cli';

// iOS wrapper shell: the native app loads the live site (interim
// remote-origin dogfood architecture — see
// docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b-2026-08-03.md on the overnight
// branch: server.url is a live-reload feature per official Capacitor docs
// and this design must never graduate to an external/App-Review build).
// Web deploys update the app instantly — no App Store re-submission for
// normal changes. Only native-shell changes (this config, plugins, icons)
// require a new build through .github/workflows/ios-testflight.yml.
//
// ORIGIN IS CONFIG-DRIVEN (operator directive 2026-08-03): the canonical
// origin is https://next-bar.com. Until next-bar.com DNS points at
// production, a binary built with the default would load nothing — for a
// pre-DNS internal build, set CAP_SERVER_URL to the current live host at
// `npx cap sync ios` time (the workflow exposes this as the optional
// `server_url` dispatch input). Never hard-code a host here again.
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://next-bar.com';

const config: CapacitorConfig = {
  appId: 'com.nextbar.app',
  appName: 'Next Bar',
  // Offline fallback shell only — real content comes from server.url.
  webDir: 'native/shell',
  server: {
    url: serverUrl,
    // Keep in-webview navigation on our origin; everything else opens in
    // Safari (Capacitor default), which is what Apple review expects.
    // The canonical hosts stay allowed even when an override is active so
    // a DNS cutover mid-testing cannot strand an installed build.
    allowNavigation: [
      ...new Set([new URL(serverUrl).host, 'next-bar.com', 'www.next-bar.com']),
    ],
  },
  ios: {
    backgroundColor: '#0a0a0a',
    contentInset: 'automatic',
  },
};

export default config;
