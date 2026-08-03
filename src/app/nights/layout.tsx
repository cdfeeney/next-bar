import type { Metadata } from 'next';

// The page is a client component, so its metadata lives here
// (g-b83d1c77 metadata reconciliation).
export const metadata: Metadata = {
  title: 'Nights Out — Next Bar',
  description:
    'Every night the app logged — stops, ratings, and the map, newest first.',
};

export default function NightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
