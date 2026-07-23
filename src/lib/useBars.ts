'use client';

/**
 * Client half of the catalog accessor. Kept separate from catalog.ts
 * because that module is imported by SERVER components (share page, edge
 * OG image) and Next 14's RSC compiler rejects React hook imports in a
 * server module — splitting the hook out is what keeps `next build` green
 * (Codex review, B1).
 */

import { useSyncExternalStore } from 'react';
import type { Bar } from '@/types';
import { getBarsSnapshot, subscribeCatalog } from '@/lib/catalog';

/**
 * Returns the catalog synchronously (no loading flash today) and
 * re-renders subscribers when `replaceCatalog` swaps in a refreshed
 * catalog later. Server snapshot is the same static cache, so SSR and
 * hydration agree.
 */
export function useBars(): Bar[] {
  return useSyncExternalStore(subscribeCatalog, getBarsSnapshot, getBarsSnapshot);
}
