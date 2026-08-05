import type { Metadata } from 'next';

// The page is a client component, so its metadata lives here
// (g-b83d1c77 metadata reconciliation — it inherited the root pair).
export const metadata: Metadata = {
  title: 'Sign in — Next Bar',
  description: 'Sign in to sync your ratings and vibe profile across devices.',
  // Route-specific social metadata — top-level fields don't cascade into
  // the root's openGraph/twitter objects (santa: Codex, round 2).
  openGraph: {
    title: 'Sign in — Next Bar',
    description: 'Sync your ratings and vibe profile across devices.',
    url: '/auth',
  },
  twitter: {
    title: 'Sign in — Next Bar',
    description: 'Sync your ratings and vibe profile across devices.',
  },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
