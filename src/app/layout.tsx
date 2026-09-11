import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Playfair_Display, Nunito_Sans, Poppins } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import AgeGate from '@/components/AgeGate';
import BottomNav from '@/components/BottomNav';
import OnboardingGate from '@/components/OnboardingGate';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import CatalogRefresh from '@/components/CatalogRefresh';
import PendingInviteRedirect from '@/components/PendingInviteRedirect';

// Brand type (operator, 2026-09-03): Playfair Display for display/headlines,
// Nunito Sans for body. This replaces the single-family Poppins kit of
// 2026-07-23 — the display/body split already existed in tailwind.config.ts
// with both slots pointing at Poppins, so this fills the split rather than
// creating it. Both self-hosted by next/font at build time (no runtime request
// to Google, which is what keeps the PWA offline behaviour intact).
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-display',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

// NEXT/FONT HAS NO METRICS FOR NUNITO SANS, and the build says so: "Failed to
// find font override values for font `Nunito Sans`". That means it cannot
// synthesise the size-adjusted local fallback it normally uses to hold layout
// still while a webfont loads. Adding `fallback` alone does NOT fix it — that
// was tried, the warning persisted, and claiming otherwise would be a comment
// that lies. `adjustFontFallback: false` states the situation honestly: stop
// attempting an override that cannot be computed, and use the stack below.
//
// What that costs: a small first-paint reflow on a cold cache, bounded by how
// close the fallback stack is to Nunito's metrics. What it buys: a clean build,
// and no silent half-configured override. If the shift proves visible on a real
// phone, the fix is a local @font-face with a measured size-adjust, not this
// knob.
const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
  adjustFontFallback: false,
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

// V10-06 (owner, build 11, 2026-09-10): the bottom nav goes back to the V8
// face - Poppins Bold uppercase - which is what the owner liked. Loaded at the
// one weight the nav uses; nothing else in the app renders Poppins.
const poppinsNav = Poppins({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  variable: '--font-nav',
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Next Bar — your next NYC bar, picked for you',
  description:
    "Stop going to the same three bars. Take the vibe quiz, find your spot, and find the bar your whole group agrees on.",
  applicationName: 'Next Bar',
  keywords: ['NYC bars', 'nightlife', 'bar finder', 'Manhattan', 'going out'],
  appleWebApp: {
    capable: true,
    title: 'Next Bar',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: 'Next Bar',
    title: 'Next Bar — your next NYC bar, picked for you',
    description:
      'Beli for bars. Take the vibe quiz, find your spot, and find the bar your whole group agrees on.',
    url: siteUrl,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Next Bar — your next NYC bar, picked for you',
    description:
      'Beli for bars. Take the vibe quiz, find your spot, and find the bar your whole group agrees on.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${nunitoSans.variable} ${poppinsNav.variable}`}>
      <body className="bg-bg text-text font-sans antialiased pb-[calc(64px+env(safe-area-inset-bottom))]">
        {children}
        <BottomNav />
        <AgeGate />
        <OnboardingGate />
        <ServiceWorkerRegister />
        <CatalogRefresh />
        <PendingInviteRedirect />
      </body>
    </html>
  );
}
