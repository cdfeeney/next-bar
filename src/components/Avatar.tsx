/**
 * Initials avatar chip. Deterministic warm-tone background derived from the
 * handle so each friend reads as a distinct person without needing images.
 */

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, string> = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-12 h-12 text-sm',
  lg: 'w-20 h-20 text-2xl',
};

// Warm palette that sits next to the #ff5b3a accent without clashing.
const TONES = [
  'bg-[#ff5b3a] text-[#0a0a0a]',
  'bg-[#e0a52e] text-[#0a0a0a]',
  'bg-[#c54328] text-[#f5f5f0]',
  'bg-[#7a5cff] text-[#f5f5f0]',
  'bg-[#2eb6a5] text-[#0a0a0a]',
  'bg-[#d6566f] text-[#f5f5f0]',
];

function toneFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(hash) % TONES.length];
}

export default function Avatar({
  initials,
  seed,
  size = 'md',
}: {
  initials: string;
  seed: string;
  size?: Size;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex items-center justify-center rounded-full font-display shrink-0',
        SIZES[size],
        toneFor(seed),
      ].join(' ')}
    >
      {initials}
    </span>
  );
}
