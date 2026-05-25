import Link from 'next/link';

export default function Hero() {
  return (
    <section className="px-6 pt-24 pb-20 md:pt-32 md:pb-28">
      <div className="max-w-4xl mx-auto text-center">
        <p className="text-accent uppercase tracking-[0.3em] text-xs mb-10">
          Manhattan · Est. 2026
        </p>

        <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[1.02] mb-10 tracking-tight">
          Stop going to the
          <br />
          <span className="italic">same three bars.</span>
        </h1>

        <p className="text-muted text-lg md:text-xl max-w-2xl mx-auto mb-12 leading-relaxed">
          Ninety seconds. Six questions. A list of ten New York bars
          built for the night you actually want.
        </p>

        <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center justify-center max-w-md md:max-w-none mx-auto">
          <Link
            href="/quiz"
            className="w-full md:w-auto min-h-[44px] touch-manipulation bg-accent text-bg hover:bg-accentDim transition-colors font-display text-lg px-8 py-4 rounded-full inline-flex items-center justify-center"
          >
            Take the vibe quiz →
          </Link>

          <Link
            href="/where-next"
            className="w-full md:w-auto min-h-[44px] touch-manipulation bg-transparent border border-border text-text hover:border-accent transition-colors font-display text-lg px-8 py-4 rounded-full inline-flex flex-col items-center justify-center leading-tight"
          >
            <span>Where next?</span>
            <span className="text-muted text-xs font-sans normal-case tracking-normal mt-0.5">
              Already out
            </span>
          </Link>
        </div>

        <p className="text-muted text-xs uppercase tracking-widest mt-8">
          No signup · No app required yet
        </p>
      </div>
    </section>
  );
}
