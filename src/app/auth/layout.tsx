import type { Metadata } from 'next';

// The page is a client component, so its metadata lives here
// (g-b83d1c77 metadata reconciliation — it inherited the root pair).
export const metadata: Metadata = {
  title: 'Sign in — Next Bar',
  description: 'Sign in to sync your ratings and vibe profile across devices.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
