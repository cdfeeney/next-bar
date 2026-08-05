import type { Metadata } from 'next';

// The profile + shared-night pages are client components with rich OG
// images but generic tab titles (g-b83d1c77 metadata reconciliation).
// The handle comes from the URL and is display-only here — the pages
// themselves validate it against authoritative data (a spoofed handle
// only mislabels its own tab, same exposure as the OG image route).
// NO decodeURIComponent: Next 14 delivers params already decoded, and a
// second decode throws on inputs like /u/%25 (santa: Codex).
export function generateMetadata({
  params,
}: {
  params: { handle: string };
}): Metadata {
  const handle = params.handle;
  return {
    title: `@${handle} — Next Bar`,
    description: `@${handle}'s bar list on Next Bar.`,
    openGraph: {
      title: `@${handle} — Next Bar`,
      description: `@${handle}'s bar list on Next Bar.`,
      url: `/u/${encodeURIComponent(handle)}`,
    },
    twitter: {
      title: `@${handle} — Next Bar`,
      description: `@${handle}'s bar list on Next Bar.`,
    },
  };
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
