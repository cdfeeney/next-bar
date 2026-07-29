import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // @vitejs/plugin-react is needed so vitest can transform .tsx files —
  // the project's tsconfig has "jsx": "preserve" for Next.js, which vite
  // rejects when running tests. Test-only; doesn't affect the Next bundle.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // ceo/** holds the CEO orchestrator's guard + state tests. They live in
    // the ONE gate rather than a second config, because a suite you have to
    // remember a --config flag to run is not a gate. (Replaces the separate
    // ceo/vitest.config.mjs, deleted.)
    // scripts/** added 2026-07-29 for scripts/lib/sidecar.test.ts. The sidecar
    // invariants were previously "tested" by grepping refresh-places.mjs for
    // substrings, which passed while three real bypasses were live. Extracting
    // them to an importable module only helps if the gate actually runs the
    // tests, so the include pattern is part of the fix, not incidental to it.
    include: [
      'src/**/*.test.{ts,tsx}',
      'ceo/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,tsx}',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
