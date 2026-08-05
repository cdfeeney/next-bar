import type { Metadata } from 'next';
import Link from 'next/link';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import AppStoreCta from '@/components/AppStoreCta';

// Marketing page gets its own title/description (g-b83d1c77 metadata
// reconciliation — it inherited the generic root pair).
export const metadata: Metadata = {
  title: 'Get Next Bar — NYC bars, picked for you',
  description:
    'Stop going to the same three bars. A curated NYC nightlife matcher: tell it the night you want, it names the bar.',
  openGraph: {
    title: 'Get Next Bar — NYC bars, picked for you',
    description:
      'Stop going to the same three bars. Tell it the night you want, it names the bar.',
    url: '/install',
  },
  twitter: {
    title: 'Get Next Bar — NYC bars, picked for you',
    description:
      'Stop going to the same three bars. Tell it the night you want, it names the bar.',
  },
};

export default function InstallPage() {
  return (
    <main>
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <Link
          href="/"
          className="font-display text-accent text-sm uppercase tracking-[0.3em] min-h-[44px] inline-flex items-center touch-manipulation"
        >
          Next Bar
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/"
            className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] inline-flex items-center touch-manipulation"
          >
            Open the app
          </Link>
          <Link
            href="/quiz"
            // min-w floor: "Quiz" is a 4-character label and measured 30px
            // wide. Height was already fine; width was the failure.
            className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] min-w-[44px] inline-flex items-center justify-center touch-manipulation"
          >
            Quiz
          </Link>
        </nav>
      </header>

      <Hero />
      <HowItWorks />
      <AppStoreCta variant="quiz" />

      <footer className="border-t border-border px-6 py-10 text-center">
        <p className="text-muted text-xs uppercase tracking-widest">
          Next Bar · NYC · 2026
        </p>
      </footer>
    </main>
  );
}
