/**
 * Census provider contract (goal g-4531bbf0, operator-locked shape).
 *
 * Providers return NORMALIZED candidates plus the evidence that backs them,
 * a cursor for resume, retry metadata, and a saturation signal. A candidate
 * with no evidence stays 'unverified' — nothing in the census pipeline may
 * promote it; 'verified' is an ATTENDED curation/apply-time label only.
 */

export type Verification = 'unverified' | 'verified';

export interface Evidence {
  /** `${provider}:${externalId}` — stable join key from candidates. */
  id: string;
  provider: string;
  url: string;
  externalId?: string;
  /** ISO date the evidence was retrieved; staleness-gated at apply time. */
  retrievedAt: string;
}

export interface NormalizedCandidate {
  /** Provider-scoped stable id, prefixed (e.g. `google:ChIJ…`, `osm:node/42`). */
  externalId: string;
  name: string;
  neighborhood: string;
  lat: number;
  lng: number;
  address?: string;
  priceTier?: 1 | 2 | 3 | 4;
  /** Raw provider signals (types/tags/license class) for later tagging. */
  signals: string[];
  evidenceIds: string[];
  verification: Verification;
  provider: string;
}

export interface RetryMeta {
  attempts: number;
  lastError?: string;
  retryAfterMs?: number;
}

export interface ProviderResult {
  candidates: NormalizedCandidate[];
  evidence: Evidence[];
  /** null = this unit has no further pages. */
  nextCursor: string | null;
  /** true = the unit is fully enumerated (distinct from budget exhaustion). */
  saturated: boolean;
  /** Network calls consumed by THIS invocation (0 for file sources). */
  callsUsed: number;
  retry: RetryMeta;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

/** Injected so overnight runs and tests are fixture-only — never live. */
export type Transport = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<TransportResponse>;

export interface CensusContext {
  transport: Transport;
  readTextFile: (path: string) => string;
  budgetLeft: number;
}

export interface ProviderAdapter {
  name: string;
  /** Coverage units for a borough (tiles for geo providers, the borough itself otherwise). */
  units(borough: string): string[];
  fetchUnit(
    unit: string,
    cursor: string | null,
    ctx: CensusContext,
  ): Promise<ProviderResult>;
}
