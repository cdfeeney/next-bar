import type { CapacitorConfig } from '@capacitor/cli';

// iOS wrapper shell: the native app loads the live production site.
// Web deploys update the app instantly — no App Store re-submission for
// normal changes. Only native-shell changes (this config, plugins, icons)
// require a new build through .github/workflows/ios-testflight.yml.
const config: CapacitorConfig = {
  appId: 'com.nextbar.app',
  appName: 'Next Bar',
  // Offline fallback shell only — real content comes from server.url.
  webDir: 'native/shell',
  server: {
    url: 'https://next-bar-two.vercel.app',
    // Keep in-webview navigation on our origin; everything else opens in
    // Safari (Capacitor default), which is what Apple review expects.
    allowNavigation: ['next-bar-two.vercel.app'],
  },
  ios: {
    backgroundColor: '#0a0a0a',
    contentInset: 'automatic',
  },
};

export default config;
