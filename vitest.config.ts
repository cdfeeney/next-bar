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
    // scripts/** holds the migration apply-tool's target guard. It is the one
    // piece of live-revenue code a wrong answer sends to the wrong database,
    // and until it was extracted from the script's import-time main() nothing
    // could reach it. Same gate, for the same reason ceo/** is here.
    // Two projects, ONE gate (`vitest run` still runs everything). The five
    // `*.live.test.ts` files talk to the staging transaction-mode pooler; run
    // concurrently with each other and with the CPU-heavy unit suite they hit
    // vitest's 5 s per-test timeout while every file passes alone (six stored
    // verifications failed that way on 2026-09-09, staging healthy each time).
    // `groupOrder: 1` runs them AFTER the unit group, `fileParallelism: false`
    // runs them one file at a time, and the 30 s timeout matches the
    // statement_timeout the files themselves set. No test body changed.
    // `include` lives on the projects, not here: `extends: true` MERGES arrays,
    // so a root include would leak every unit file into the live project.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'ceo/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.live.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: ['src/**/*.live.test.ts'],
          sequence: { groupOrder: 1 },
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
