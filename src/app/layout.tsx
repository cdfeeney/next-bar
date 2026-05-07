import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import 'leaflet/dist/leaflet.css';

export const metadata: Metadata = {
  title: 'Next Bar — your next NYC bar, picked for you',
  description: 'Stop going to the same three bars. Take the vibe quiz, find your spot.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text font-sans antialiased">{children}</body>
    </html>
  );
}
