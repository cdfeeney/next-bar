type Step = {
  numeral: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    numeral: 'I',
    title: 'Tell us the vibe.',
    body: 'Six questions, ninety seconds. No "rate your favorite cocktail one to ten."',
  },
  {
    numeral: 'II',
    title: 'We pick ten bars.',
    body: 'Manhattan only. Curated, not crowdsourced. Each one matched to the night you described — never the densest tag list.',
  },
  {
    numeral: 'III',
    title: 'Open the door.',
    body: 'Walk-time. Honest copy. A map. Tap a bar to open Google Maps and go. The app remembers the rest.',
  },
];

export default function HowItWorks() {
  return (
    <section className="border-t border-border px-6 py-20 md:py-28">
      <div className="max-w-5xl mx-auto">
        <p className="text-accent uppercase tracking-[0.25em] text-xs text-center mb-3">
          How it works
        </p>
        <h2 className="font-display text-4xl md:text-5xl text-center leading-tight mb-16 tracking-tight">
          The shortest distance between
          <br className="hidden md:block" /> a craving and a barstool.
        </h2>

        <ol className="grid md:grid-cols-3 gap-12 md:gap-8">
          {STEPS.map((step) => (
            <li key={step.numeral} className="text-center md:text-left">
              <p className="font-display text-accent text-3xl md:text-4xl mb-4 leading-none">
                {step.numeral}
              </p>
              <h3 className="font-display text-2xl mb-3 leading-snug">
                {step.title}
              </h3>
              <p className="text-muted text-base leading-relaxed">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
