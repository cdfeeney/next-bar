import { describe, expect, test } from 'vitest';
import {
  KPI_CONTRACTS,
  contractsAreAllowlisted,
  validateKpiPayload,
  type KpiKey,
} from '@/lib/kpiContracts';
import { ANALYTICS_EVENTS, buildEnvelope } from '@/lib/analyticsAdapters';
import { isAnalyticsEnabled, isPostHogEnabled } from '@/lib/analyticsAdapters';

describe('KPI contracts — wiring', () => {
  test('every contract targets an allowlisted analytics name', () => {
    expect(contractsAreAllowlisted()).toBe(true);
  });

  test('all eight product KPIs are specified', () => {
    expect(Object.keys(KPI_CONTRACTS).sort()).toEqual(
      [
        'bar_detail_view',
        'directions_opened',
        'pin_checkin',
        'post_night_rating',
        'recommendation_impression',
        'save_want_to_go',
        'search_selection',
        'share',
      ].sort(),
    );
  });

  test('the live envelope for a KPI name is STILL name-only (no payload channel exists)', () => {
    const envelope = buildEnvelope('checkin');
    expect(envelope).toEqual({ v: 1, name: 'checkin' });
    expect(Object.keys(envelope ?? {}).sort()).toEqual(['name', 'v']);
  });

  test('analytics and PostHog remain DARK in this environment', () => {
    expect(isAnalyticsEnabled()).toBe(false);
    expect(isPostHogEnabled()).toBe(false);
  });

  test('new names are allowlisted so future call sites need no adapter change', () => {
    for (const name of ['impression', 'bar_detail', 'directions', 'checkin', 'night_rating']) {
      expect(ANALYTICS_EVENTS as readonly string[]).toContain(name);
    }
  });
});

describe('KPI contracts — privacy validators fail closed', () => {
  test('minimal legitimate payloads validate', () => {
    expect(validateKpiPayload('pin_checkin', { barId: 'attaboy', night: '2026-08-03' }).ok).toBe(true);
    expect(validateKpiPayload('search_selection', { barId: 'attaboy' }).ok).toBe(true);
    expect(
      validateKpiPayload('recommendation_impression', { surface: 'home', resultCount: 5 }).ok,
    ).toBe(true);
    expect(
      validateKpiPayload('post_night_rating', { barId: 'pdt', tier: 'loved', night: '2026-08-03' }).ok,
    ).toBe(true);
    expect(validateKpiPayload('share', {}).ok).toBe(true); // fields optional
  });

  test.each([
    ['coordinates', 'pin_checkin', { barId: 'attaboy', lat: 40.72 }],
    ['accuracy', 'pin_checkin', { barId: 'attaboy', accuracy: 20 }],
    ['raw search text', 'search_selection', { barId: 'attaboy', query: 'divey lower east' }],
    ['friend identity', 'share', { friendHandle: 'claire' }],
    ['user identifier', 'post_night_rating', { barId: 'pdt', tier: 'loved', userId: 'u-1' }],
    ['free-form key', 'bar_detail_view', { barId: 'pdt', note: 'cool spot' }],
  ] as const)('%s is rejected outright (fail closed)', (_label, key, payload) => {
    const result = validateKpiPayload(key as KpiKey, payload as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  test('the forbidden-key belt holds even against a carelessly-extended field table (santa: Fable)', async () => {
    const { __fieldValidatorsForTests } = await import('@/lib/kpiContracts');
    const tables = __fieldValidatorsForTests();
    // Simulate the exact failure the belt exists for: a future edit
    // allowlists a forbidden-shaped field.
    tables.post_night_rating.userId = () => true;
    try {
      const result = validateKpiPayload('post_night_rating', {
        barId: 'pdt',
        tier: 'loved',
        night: '2026-08-03',
        userId: 'u-1',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('forbidden-key:userId');
    } finally {
      delete tables.post_night_rating.userId;
    }
  });

  test('smuggled values on allowlisted keys are rejected structurally', () => {
    // A "barId" that is actually free text / an address.
    expect(validateKpiPayload('share', { barId: '134 Eldridge St, NYC!' }).ok).toBe(false);
    // A "night" carrying a timestamp (too precise = re-identification risk).
    expect(
      validateKpiPayload('pin_checkin', { barId: 'attaboy', night: '2026-08-03T23:41:12Z' }).ok,
    ).toBe(false);
    // An unbounded result count.
    expect(
      validateKpiPayload('recommendation_impression', { surface: 'home', resultCount: 10_000 }).ok,
    ).toBe(false);
    // An unknown surface enum value.
    expect(
      validateKpiPayload('recommendation_impression', { surface: 'admin-panel' }).ok,
    ).toBe(false);
  });
});
