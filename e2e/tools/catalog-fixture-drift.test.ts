/**
 * Drift guard (santa: Fable): the committed e2e/fixtures/catalog-rows.json
 * is a snapshot of the bundled catalog — nothing else would notice if
 * src/lib/bars* changed (new bar, renamed id, edited tags/hours) while the
 * fixture stayed stale, and the e2e suite would keep passing against old
 * data. This regenerates the mapping in-memory and diffs it against the
 * committed file; on mismatch, the fix is one command:
 *
 *   npx tsx e2e/tools/generate-catalog-fixture.mts
 *
 * Same pattern as the SERVICE_AREA_BBOX mirror assertion in bars.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bars as staticBars } from '../../src/lib/bars';
import { rowsToCatalog } from '../../src/lib/catalogServer';
import { barToRow } from './catalogFixtureMap';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'catalog-rows.json');

describe('catalog fixture drift', () => {
  it('committed catalog-rows.json equals a fresh regeneration from src/lib/bars', () => {
    const committed = readFileSync(FIXTURE, 'utf8');
    const fresh = JSON.stringify(staticBars.map(barToRow));
    expect(
      committed === fresh,
      'e2e/fixtures/catalog-rows.json is stale vs src/lib/bars — regenerate: npx tsx e2e/tools/generate-catalog-fixture.mts',
    ).toBe(true);
  });

  it('every committed row survives rowToBar validation (none silently dropped)', () => {
    const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const catalog = rowsToCatalog(rows, staticBars.length);
    expect(catalog).not.toBeNull();
    expect(catalog!.length).toBe(staticBars.length);
  });
});
