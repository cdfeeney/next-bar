import type { Metadata } from 'next';
import Link from 'next/link';
import WaitlistForm from '@/components/WaitlistForm';

// Reconciled with the /join OG image's waitlist framing (g-b83d1c77
// audit: the OG card said "Join the waitlist" while the tab title fell
// back to the generic root metadata).
export const metadata: Metadata = {
  title: 'Join the waitlist — Next Bar',
  description:
    'Out tonight? Pick the bar with your friends. Join the Next Bar waitlist for early access.',
};

export default function JoinPage() {
  return (
    <main className="min-h-screen flex flex-col justify-center">
      {/* Landmark h1 + a way out (g-b83d1c77: /join was a dead end with no
          heading — the bottom nav is hidden here, so without this link a
          non-submitting visitor had no in-app exit, violating R5). */}
      <header className="px-6 pt-8 text-center">
        <h1 className="sr-only">Join the Next Bar waitlist</h1>
      </header>
      <WaitlistForm profile={null} />
      <p className="text-center pb-8">
        <Link
          href="/install"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← What is Next Bar?
        </Link>
      </p>
    </main>
  );
}
