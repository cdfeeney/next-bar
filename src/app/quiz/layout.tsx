import type { Metadata } from 'next';

// The page is a client component, so its metadata lives here
// (g-b83d1c77 metadata reconciliation).
export const metadata: Metadata = {
  title: 'Vibe quiz — Next Bar',
  description:
    'Eight questions about the night you want. Get bars matched to it.',
};

export default function QuizLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
