import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Poppins } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import BottomNav from '@/components/BottomNav';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

// Brand font (2026-07-23 kit): Poppins — Bold 700 wordmark/headlines,
// Medium 500 secondary headlines, Regular 400 body/captions. Self-hosted by
// next/font at build time (no runtime requests; PWA-safe).
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
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
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
