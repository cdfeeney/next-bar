import Link from 'next/link';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import AppStoreCta from '@/components/AppStoreCta';

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
            className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] inline-flex items-center touch-manipulation"
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
          Next Bar · Manhattan · 2026
        </p>
      </footer>
    </main>
  );
}
