import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // LOCKED V8 TOKENS — THE single source of these six values (plus the
      // coral's pressed shade). globals.css derives its :root custom
      // properties from this object via theme(), so no other file should carry
      // these hex codes.
      //
      // src/lib/paletteContrast.test.ts reads this object directly and fails a
      // token edit that breaks WCAG AA — but only for the SIX locked values it
      // pins and the pairings it lists. `accentDim` is deliberately outside
      // that check and is NOT contrast-validated: it is the pressed shade of
      // the coral, and dark-on-accentDim (`hover:bg-accentDim text-bg`) sits
      // below AA. Do not read this comment as cover for editing it.
      //
      // Three ways to consume them, all the same source:
      //   Tailwind class   bg-surface, text-muted, ... (opacity modifiers work)
      //   raw CSS          var(--nb-surface), ... (published in globals.css)
      //   TypeScript       import config from '@/../tailwind.config' — for the
      //                    satori/edge surfaces (opengraph-image, icon,
      //                    apple-icon, manifest) that render outside the
      //                    document and can reach neither of the above.
      colors: {
        bg: '#0a0a0a',
        surface: '#141414',
        border: '#2a2a2a',
        accent: '#ff5b3a',
        accentDim: '#c54328',
        text: '#f5f5f0',
        muted: '#8a8a85',
      },
      // Brand kit 2026-07-23: Poppins everywhere (Bold headlines via
      // .font-display weight rule in globals.css; Regular body).
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // V10-01 label role: small uppercase labels (nav, section labels, chips,
        // 12px-and-under buttons) use the body face; weight lives in globals.css.
        label: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // V10-06: bottom-nav face only - the V8 Poppins look the owner asked back.
        nav: ['var(--font-nav)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
