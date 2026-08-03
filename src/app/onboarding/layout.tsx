import type { Metadata } from 'next';

// The page is a client component, so its metadata lives here
// (g-b83d1c77 metadata reconciliation).
export const metadata: Metadata = {
  title: 'Set up your profile — Next Bar',
  description: 'Pick a name and a handle so friends can find you.',
  openGraph: {
    title: 'Set up your profile — Next Bar',
    description: 'Pick a name and a handle so friends can find you.',
    url: '/onboarding',
  },
  twitter: {
    title: 'Set up your profile — Next Bar',
    description: 'Pick a name and a handle so friends can find you.',
  },
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
