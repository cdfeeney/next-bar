import { describe, expect, it, vi } from 'vitest';

import { pageAll } from './page-all.mjs';

/**
 * The defect: the SLA lane issued ONE request with `$limit: 5000` and no
 * truncation check, so a region holding more licences than the limit was
 * silently censored while the run reported COMPLETE. Acceptance criterion 1
 * requires cap detection on every lane, SLA pagination included.
 */
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('pageAll', () => {
  it('keeps reading while pages come back full', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(rowsOf(100))
      .mockResolvedValueOnce(rowsOf(100))
      .mockResolvedValueOnce(rowsOf(40));

    const rows = await pageAll({ fetchPage, pageSize: 100, maxRows: 10_000, label: 'test' });

    expect(rows).toHaveLength(240);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 100, 200]);
  });

  it('stops on the first short page without an extra request', async () => {
    // The short page IS the proof of exhaustion; asking again costs money.
    const fetchPage = vi.fn().mockResolvedValue(rowsOf(3));

    const rows = await pageAll({ fetchPage, pageSize: 100, maxRows: 10_000, label: 'test' });

    expect(rows).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('treats an exactly-full single page as truncated, not complete', async () => {
    // This is the original bug in miniature: 100 rows at a limit of 100 was
    // reported as the whole answer.
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(rowsOf(100))
      .mockResolvedValueOnce(rowsOf(0));

    const rows = await pageAll({ fetchPage, pageSize: 100, maxRows: 10_000, label: 'test' });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(100);
  });

  it('refuses rather than silently truncating at the ceiling', async () => {
    // Never report a number we already know is short.
    const fetchPage = vi.fn().mockResolvedValue(rowsOf(100));

    await expect(
      pageAll({ fetchPage, pageSize: 100, maxRows: 300, label: 'NY SLA read for bk' }),
    ).rejects.toThrow(/NY SLA read for bk hit the 300-row ceiling/);
  });

  it('rejects a nonsensical page size instead of looping forever', async () => {
    await expect(
      pageAll({ fetchPage: vi.fn(), pageSize: 0, maxRows: 100, label: 'test' }),
    ).rejects.toThrow(/pageSize must be a positive number/);
  });
});
