import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // LOCKED V8 TOKENS — THE single source of these six values (plus the
      // coral's pressed shade). src/lib/paletteContrast.test.ts reads this
      // object directly and fails a token edit that breaks WCAG AA, and
      // globals.css derives its :root custom properties from it via theme(),
      // so no other file should carry these hex codes.
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
        display: ['var(--font-poppins)', 'ui-sans-serif', 'sans-serif'],
        sans: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
