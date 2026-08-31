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
    include: ['src/**/*.test.{ts,tsx}', 'ceo/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // 30s, RAISED FROM VITEST'S 5s DEFAULT 2026-08-31, and this is a measurement not a
    // preference. The migration-text guards (definingMigration, effectiveView and the
    // ordering invariants built on them) re-read and skeletonise EVERY file in
    // supabase/migrations on each call, and that corpus crossed half a megabyte when phase C
    // restored 0020-0032 and the V8 lanes added 0065-0075 - 0066, 0067, 0068 and 0069 are
    // ~470KB between them. Six assertions in friendRatingsScore and nightOutsMigration began
    // timing out at 5s UNDER PARALLEL CONTENTION while passing in isolation, which reads
    // exactly like a broken contract and is not one.
    //
    // THE REAL FIX IS MEMOISATION AND IT WAS DELIBERATELY NOT DONE HERE. Caching the parsed
    // migration text would serve STALE SQL to the mutation probes, which rewrite a migration
    // file mid-run and expect the guard to notice - a cache would make a security guard pass
    // against text that is no longer on disk. That trade needs its own review, not a
    // merge-time edit.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
