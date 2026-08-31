import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Criterion 10, the half a browser test cannot see: "There is exactly ONE
 * camera system." A second `getUserMedia` caller is how that stops being true,
 * and it would appear in a NEW file — which is precisely what a spec that
 * counts choosers inside one already-open flow can never notice.
 *
 * Source-level on purpose. It is the same shape as `storageInventory.test.ts`:
 * a rule about the repository, enforced by reading the repository.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('one camera system', () => {
  it('opens a camera stream from exactly one module', () => {
    const owners = sourceFiles(SRC).filter((file) =>
      /getUserMedia\s*\(/.test(readFileSync(file, 'utf8')),
    );
    const relative = owners.map((file) =>
      file.slice(SRC.length + 1).split(sep).join('/'),
    );
    expect(relative).toEqual([
      'components/capture/useCamera.ts',
    ]);
  });
});
