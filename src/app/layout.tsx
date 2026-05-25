import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import BottomNav from '@/components/BottomNav';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Next Bar — your next NYC bar, picked for you',
  description:
    "Stop going to the same three bars. Take the vibe quiz, find your spot.",
  applicationName: 'Next Bar',
  appleWebApp: {
    capable: true,
    title: 'Next Bar',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
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
    <html lang="en">
      <body className="bg-bg text-text font-sans antialiased pb-[calc(64px+env(safe-area-inset-bottom))]">
        {children}
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
