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
const rawOverride = (process.env.CAP_SERVER_URL ?? '').trim();
const serverUrl = rawOverride === '' ? 'https://next-bar.com' : rawOverride;

// Fail closed, and fail LEGIBLY, on a bad override: the value must be a
// clean https:// ORIGIN — nothing else. Without this, an http:/file:/
// javascript: value would pass config loading (iOS ATS would then brick an
// http build AFTER upload), a scheme-less typo would surface only as a
// bare "Invalid URL" stack trace deep in the CLI, and a path/query/
// fragment (think a pasted preview URL with ?token=...) would be baked
// verbatim into the shipped binary as its entry URL (review rounds:
// Codex M2 + Fable LOW, then Codex round-2 origin-only).
const parsedOrigin = (() => {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(
      `Invalid CAP_SERVER_URL: "${serverUrl}" — must be a full https:// origin (e.g. https://next-bar.com)`,
    );
  }
  if (parsed.protocol !== 'https:' || parsed.hostname === '' || parsed.username || parsed.password) {
    throw new Error(
      `Invalid CAP_SERVER_URL: "${serverUrl}" — only a credential-free https:// origin is allowed`,
    );
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(
      `Invalid CAP_SERVER_URL: "${serverUrl}" — origin only, no path/query/fragment (e.g. https://next-bar.com)`,
    );
  }
  return parsed;
})();

const config: CapacitorConfig = {
  appId: 'com.nextbar.app',
  appName: 'Next Bar',
  // Offline fallback shell — served when the remote origin cannot load.
  webDir: 'native/shell',
  server: {
    // The NORMALIZED origin, never the raw input (strips a trailing slash;
    // guarantees what ships is exactly scheme://host[:port]).
    url: parsedOrigin.origin,
    // Without errorPath, webDir content is merely PACKAGED, never shown:
    // a failed remote load renders a blank webview instead of the
    // fallback page (review: Codex M1 — latent since PR #90, and load-
    // bearing now that the default origin predates its DNS).
    errorPath: 'index.html',
    // Keep in-webview navigation on our origin; everything else opens in
    // Safari (Capacitor default), which is what Apple review expects.
    // The canonical hosts stay allowed even when an override is active so
    // a DNS cutover mid-testing cannot strand an installed build.
    allowNavigation: [
      ...new Set([parsedOrigin.host, 'next-bar.com', 'www.next-bar.com']),
    ],
  },
  ios: {
    backgroundColor: '#0a0a0a',
    contentInset: 'automatic',
  },
};

export default config;
