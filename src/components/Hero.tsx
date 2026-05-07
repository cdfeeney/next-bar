'use client';

type HeroProps = { onStart: () => void };

export default function Hero({ onStart }: HeroProps) {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <p className="text-accent uppercase tracking-widest text-xs mb-6">
        Next Bar — NYC
      </p>
      <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-tight mb-6">
        Stop going to the
        <br />
        same three bars.
      </h1>
      <p className="text-muted text-lg md:text-xl max-w-xl mb-10">
        Take the vibe quiz. Get bars that match you, sorted by how far they are right now.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="bg-accent hover:bg-accentDim transition-colors text-text font-display text-lg px-8 py-4 rounded-full"
      >
        Start the quiz →
      </button>
      <p className="text-muted text-sm mt-4">90 seconds. No signup needed.</p>
    </section>
  );
}
