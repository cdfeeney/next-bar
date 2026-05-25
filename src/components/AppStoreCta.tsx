import Link from 'next/link';
import InstallPrompt from '@/components/InstallPrompt';

type AppStoreCtaProps = {
  variant?: 'quiz' | 'where-next' | 'tried';
};

const HEADLINES: Record<NonNullable<AppStoreCtaProps['variant']>, string> = {
  quiz: 'Want this in your pocket?',
  'where-next': 'Carry your next-bar everywhere.',
  tried: 'Your nightlife, kept.',
};

const SUBHEADS: Record<NonNullable<AppStoreCtaProps['variant']>, string> = {
  quiz:
    'These ten bars are a teaser. Install Next Bar on your phone and it remembers what you love, learns your radius, and surfaces the next round in two taps.',
  'where-next':
    'Install on your home screen and Next Bar remembers your taste, picks up where you left off, and gets faster every time.',
  tried:
    'Install Next Bar on your home screen to keep your ratings close. Cross-device sync ships with the App Store launch.',
};

export default function AppStoreCta({ variant = 'quiz' }: AppStoreCtaProps) {
  const headline = HEADLINES[variant];
  const subhead = SUBHEADS[variant];

  return (
    <section className="border-t border-border mt-16">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-6">
          Install now · App Store coming
        </p>
        <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] mb-6">
          {headline}
        </h2>
        <p className="text-muted text-base md:text-lg max-w-xl mx-auto mb-10 leading-relaxed">
          {subhead}
        </p>

        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4 flex-wrap">
          <InstallPrompt />

          <Link
            href="/join"
            className="inline-flex items-center justify-center gap-3 bg-transparent border border-border hover:border-accent transition-colors text-text font-display text-base px-6 py-3 rounded-2xl min-h-[44px] touch-manipulation"
          >
            <AppleIcon className="w-5 h-5" />
            <span className="flex flex-col items-start leading-tight text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted">
                Get notified
              </span>
              <span className="text-base">App Store</span>
            </span>
          </Link>
        </div>

        <p className="text-muted text-xs mt-6">
          Already installed? You&apos;ll find Next Bar on your home screen.
        </p>
      </div>
    </section>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.365 1.43c0 1.14-.43 2.21-1.15 3-.78.85-2.07 1.5-3.1 1.42-.12-1.12.43-2.27 1.13-3 .78-.83 2.13-1.45 3.12-1.42zM20.5 17.18c-.55 1.28-.82 1.85-1.53 2.99-1 1.6-2.41 3.6-4.16 3.61-1.55.01-1.95-1.01-4.05-1-2.1.01-2.54 1.02-4.1 1.01-1.75-.01-3.08-1.82-4.08-3.42C-.18 16 .1 11.21 2.5 9.06c1.39-1.24 3.2-1.96 4.92-1.96 1.76 0 2.86 1 4.31 1 1.4 0 2.26-1 4.3-1 1.54 0 3.17.84 4.33 2.29-3.8 2.08-3.18 7.5.14 9.79z" />
    </svg>
  );
}
