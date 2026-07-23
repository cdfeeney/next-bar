import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
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
