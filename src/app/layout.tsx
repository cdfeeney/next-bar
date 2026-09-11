import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Poppins } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import AgeGate from '@/components/AgeGate';
import BottomNav from '@/components/BottomNav';
import OnboardingGate from '@/components/OnboardingGate';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import CatalogRefresh from '@/components/CatalogRefresh';
import PendingInviteRedirect from '@/components/PendingInviteRedirect';

// V10-07 (owner, 2026-09-11, on staging): the V8 Poppins kit is back for the
// whole app. The 2026-09-08 Playfair + Nunito Sans pair (V9-11) was rejected
// on the phone. One face, four tokens: --font-display/--font-sans/--font-label/
// --font-nav all resolve to Poppins so no component had to change; the
// weights per role live in globals.css. Self-hosted by next/font at build
// time (no runtime request; PWA-safe).
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
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
    <html lang="en" className={poppins.variable}>
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
