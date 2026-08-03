import type { Metadata } from 'next';

// Shared-night tab title (g-b83d1c77): the OG image is per-night dynamic;
// the tab title stays generic-but-relevant — night details load client-side
// behind the bearer token, so nothing sensitive belongs in static metadata.
// NO decodeURIComponent — params arrive decoded in Next 14; a second
// decode throws on %-inputs (santa: Codex).
export function generateMetadata({
  params,
}: {
  params: { handle: string };
}): Metadata {
  const handle = params.handle;
  return {
    title: `@${handle}'s night out — Next Bar`,
    description: 'A night out on Next Bar — the route, the stops, the map.',
  };
}

export default function SharedNightLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
