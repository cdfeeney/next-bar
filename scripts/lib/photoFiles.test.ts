import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IMAGE_EXTENSIONS,
  assertDbIdsUsable,
  backupAndDeleteOrphans,
  MAX_PHOTO_INDEX,
  isImageFilename,
  isReachable,
  partitionPhotoFiles,
  stripExtension,
} from './photoFiles.mjs';

/**
 * Tests for the logic behind scripts/prune-orphan-photos.mjs, which DELETES FILES.
 *
 * santa-loop round 2 flagged that script as shipping with no tests at all — the
 * rigor had gone to the module it replaced rather than to the code that actually
 * removes data. It also could not be tested in place: it has top-level side
 * effects (`refuseIfUnattended`, `await main()`), so importing it would run it.
 * Hence the extraction into photoFiles.mjs.
 */

const KNOWN = new Set([
  'attaboy',
  'bar',        // deliberately a PREFIX of the next one
  'bar-54',     // a live venue whose id ends in a number
  'blind-tiger',
  'pencil-factory', // DB-only
]);

describe('isReachable — exact id must beat the carousel-suffix rule', () => {
  /**
   * The near miss this whole module exists for. An earlier version stripped any
   * trailing `-<digits>` BEFORE looking anything up, so `bar-54.webp` resolved as
   * photo #54 of `bar` — and since 54 is out of carousel range, the live venue
   * bar-54's photo was classified as an orphan. Five live venues were affected
   * (sunswick-3535, studio-151, dive-75, bar-54, terminal-5).
   */
  test('bar-54 resolves as the VENUE bar-54, not photo 54 of bar', () => {
    expect(isReachable('bar-54', KNOWN)).toBe(true);
  });

  test('a real carousel photo of a known id is reachable', () => {
    expect(isReachable('attaboy-2', KNOWN)).toBe(true);
    expect(isReachable('attaboy-3', KNOWN)).toBe(true);
  });

  test('an out-of-range carousel index is NOT reachable', () => {
    // 54 is not a photo index, and `bar-54` only matched above because it is
    // itself a known id. A prefix match alone must not rescue an absurd index.
    expect(isReachable('bar-99', KNOWN)).toBe(false);
    expect(isReachable(`attaboy-${MAX_PHOTO_INDEX + 1}`, KNOWN)).toBe(false);
  });

  test('the cap itself is INCLUSIVE — n === maxIndex is still reachable', () => {
    // The recorded gap was "nothing pins that an index above the cap is
    // rejected", but that was already covered above. The genuinely unpinned
    // edge is the other side of the same boundary: with only the
    // MAX_PHOTO_INDEX + 1 case asserted, narrowing `n <= maxIndex` to
    // `n < maxIndex` passes every existing test while silently making the
    // last carousel photo of every venue an orphan — i.e. deletable.
    expect(isReachable(`attaboy-${MAX_PHOTO_INDEX}`, KNOWN)).toBe(true);
  });

  test('an explicit maxIndex overrides the default on both sides', () => {
    expect(isReachable('attaboy-3', KNOWN, 3)).toBe(true);
    expect(isReachable('attaboy-4', KNOWN, 3)).toBe(false);
  });

  test('index 1 is not a valid suffix — photo one has no suffix', () => {
    expect(isReachable('attaboy-1', KNOWN)).toBe(false);
  });

  test('an unknown id cannot borrow reachability from a numeric suffix', () => {
    expect(isReachable('ghost-bar-2', KNOWN)).toBe(false);
    expect(isReachable('ghost-bar', KNOWN)).toBe(false);
  });

  test('a DB-only venue is reachable when present in the known set', () => {
    expect(isReachable('pencil-factory', KNOWN)).toBe(true);
    // …and would be classed an orphan if the DB were wrong, which is exactly why
    // prune-orphan-photos.mjs refuses to run when DB_ONLY_SIDECAR_IDS is missing.
    expect(isReachable('pencil-factory', new Set(['attaboy']))).toBe(false);
  });

  test('an id that merely starts with a known id is not reachable', () => {
    expect(isReachable('attaboy-annex', KNOWN)).toBe(false);
  });
});

describe('filename helpers', () => {
  test('recognises every extension the pipeline produces', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isImageFilename(`attaboy.${ext}`), ext).toBe(true);
    }
    expect(isImageFilename('attaboy.WEBP')).toBe(true); // case-insensitive
  });

  test('rejects non-images', () => {
    expect(isImageFilename('README.md')).toBe(false);
    expect(isImageFilename('attaboy')).toBe(false);
    expect(isImageFilename('attaboy.webp.bak')).toBe(false);
  });

  test('stripExtension removes only a trailing image extension', () => {
    expect(stripExtension('bar-54.webp')).toBe('bar-54');
    // A dot inside the id must survive.
    expect(stripExtension('a.b.webp')).toBe('a.b');
  });
});

describe('partitionPhotoFiles never offers a non-file for deletion', () => {
  /**
   * Faithful Dirent stub: a real entry is a file XOR a directory, so the stub
   * reports both. Without isDirectory these stubs THROW under any production
   * change that consults it, which reads as "the test caught the bug" when it
   * actually only crashed. The one entry that is neither (a symlink) is stubbed
   * explicitly in its own test below.
   */
  const dirent = (name: string, isFile = true) => ({
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
  });

  test('classifies reachable, orphan, and skipped correctly', () => {
    const { reachable, orphans, skipped } = partitionPhotoFiles(
      [
        dirent('attaboy.webp'),
        dirent('attaboy-2.webp'),
        dirent('bar-54.webp'),
        dirent('ghost-bar.webp'),
        dirent('README.md'),
        dirent('thumbnails', false),
      ],
      KNOWN,
    );

    expect(reachable.sort()).toEqual(['attaboy-2.webp', 'attaboy.webp', 'bar-54.webp']);
    expect(orphans).toEqual(['ghost-bar.webp']);
    // A subdirectory used to crash the delete loop at copyFileSync (EISDIR) after
    // part of the backup was written; a stray non-image would have been deleted
    // because its name did not look like a venue id.
    expect(skipped.sort()).toEqual(['README.md', 'thumbnails']);
  });

  test('a subdirectory is never an orphan even if its name looks unknown', () => {
    const { orphans, skipped } = partitionPhotoFiles([dirent('ghost-bar', false)], KNOWN);
    expect(orphans).toEqual([]);
    expect(skipped).toEqual(['ghost-bar']);
  });

  /**
   * G6. The test above is VACUOUS as a guard on `entry.isFile()`: the fixture is
   * named `ghost-bar`, with NO image extension, so `isImageFilename` already
   * rejects it and it lands in `skipped` without the isFile() result ever being
   * consulted. santa-loop round 3 proved exactly that — deleting the
   * `entry.isFile()` guard from photoFiles.mjs left all 17 tests green.
   *
   * Only a directory whose name ALSO looks like an image can exercise the guard.
   * `ghost-bar.webp` is the sharpest possible fixture because the sibling test
   * above uses that exact string as a genuine FILE orphan: same name, opposite
   * isFile(), opposite expected bucket. The difference in outcome can therefore
   * only come from the isFile() check.
   */
  test('a DIRECTORY named like an image is skipped, not deleted (mocked dirent)', () => {
    const { reachable, orphans, skipped } = partitionPhotoFiles(
      [dirent('ghost-bar.webp', false), dirent('attaboy.webp')],
      KNOWN,
    );
    // The directory must NOT be offered for deletion...
    expect(orphans).toEqual([]);
    expect(skipped).toEqual(['ghost-bar.webp']);
    // ...and real image files must still be classified normally.
    expect(reachable).toEqual(['attaboy.webp']);
  });
});

describe('partitionPhotoFiles against REAL fs.Dirent objects (G6)', () => {
  /**
   * The mocked-dirent test above pins the logic, but the production caller is
   * `fs.readdirSync(PHOTO_DIR, { withFileTypes: true })` in
   * scripts/prune-orphan-photos.mjs:104. A hand-rolled `{ name, isFile() }` stub
   * cannot prove real Dirents behave the same way, and this module guards a
   * script that DELETES FILES — so the fixture here is a real directory tree.
   *
   * Written under the OS temp dir, never inside public/ or any real photo
   * directory, and removed afterwards. No real photo is read, moved, or deleted.
   */
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'next-bar-photofiles-'));
    // Real image FILES.
    writeFileSync(join(dir, 'attaboy.webp'), '');       // reachable (known id)
    writeFileSync(join(dir, 'bar-54.webp'), '');        // reachable (id ends in a number)
    writeFileSync(join(dir, 'wiped-out.webp'), '');     // a genuine orphan
    writeFileSync(join(dir, 'README.md'), '');          // non-image -> skipped
    // A real DIRECTORY whose name looks exactly like an image file. This is the
    // entry that only `entry.isFile()` can catch.
    mkdirSync(join(dir, 'ghost-bar.webp'));
  });

  afterAll(() => {
    // Guarded: if mkdtempSync itself threw, `dir` is undefined and rmSync would
    // throw a type error rather than swallow it the way `force: true` swallows
    // ENOENT — turning a disk-full/permissions failure into a confusing
    // teardown error on top of the real one.
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('excludes the image-named directory while still including real images', () => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const { reachable, orphans, skipped } = partitionPhotoFiles(entries, KNOWN);

    // EXCLUSION: the directory is never deletable, despite an unknown id AND an
    // image extension — the two things that otherwise define an orphan.
    expect(orphans).not.toContain('ghost-bar.webp');
    expect(skipped).toContain('ghost-bar.webp');

    // INCLUSION: real files are still partitioned correctly, so the guard is
    // narrow rather than a blanket "skip everything".
    expect(reachable.sort()).toEqual(['attaboy.webp', 'bar-54.webp']);
    expect(orphans).toEqual(['wiped-out.webp']);
    expect(skipped.sort()).toEqual(['README.md', 'ghost-bar.webp']);
  });

  test('an entry that is NEITHER a file nor a directory is also skipped', () => {
    /**
     * Closes a gap a routed reviewer (GLM) found and two other lanes missed:
     * every other fixture here is either a real file or a real directory, so
     * rewriting the production guard from `!isFile` to `isDirectory` would keep
     * ALL of those assertions green while changing behaviour.
     *
     * The entry that separates the two is a symlink: for an fs.Dirent from
     * readdirSync(withFileTypes) a symlink reports isFile() === false AND
     * isDirectory() === false. Under the real guard it is skipped; under an
     * `isDirectory` guard it passes the image check, fails isReachable, and is
     * DELETED. So the guard means "only regular files are deletable", and that
     * is what this pins.
     *
     * Asserted through a stub rather than a real symlink on purpose: creating
     * one on Windows needs elevation or Developer Mode, and this repo's
     * operator is on Windows — a test that silently skips on the primary dev
     * platform would be worse than no test. The real-Dirent path is already
     * covered by the directory fixture above.
     */
    const notFileNotDir = {
      name: 'stray.webp', // image-looking name, unknown venue id
      isFile: () => false,
      isDirectory: () => false,
    };
    const realFileStub = (name: string) => ({
      name,
      isFile: () => true,
      isDirectory: () => false,
    });
    const { orphans, skipped } = partitionPhotoFiles(
      [notFileNotDir, realFileStub('attaboy.webp')],
      KNOWN,
    );
    // Must NOT be offered for deletion despite looking exactly like an orphan.
    expect(orphans).toEqual([]);
    expect(skipped).toEqual(['stray.webp']);
    // And a real file alongside it is still classified normally, so the guard
    // is narrow rather than a blanket "skip anything unusual".
    expect(
      partitionPhotoFiles([notFileNotDir, realFileStub('attaboy.webp')], KNOWN).reachable,
    ).toEqual(['attaboy.webp']);
  });

  test('the fixture really is a directory, so the guard is what excludes it', () => {
    // Guards the GUARD: if this fixture silently became a file, the test above
    // would still pass for the wrong reason and go quietly vacuous again.
    const entry = readdirSync(dir, { withFileTypes: true }).find(
      (e) => e.name === 'ghost-bar.webp',
    );
    expect(entry).toBeDefined();
    expect(entry?.isFile()).toBe(false);
    expect(entry?.isDirectory()).toBe(true);
    // And its name genuinely looks like an image — otherwise the extension
    // check, not isFile(), would be doing the work.
    expect(isImageFilename('ghost-bar.webp')).toBe(true);
    // ...and its basename is NOT a known venue, so it would be an ORPHAN
    // (deletable) if it were a file. That is what makes the guard load-bearing.
    expect(isReachable('ghost-bar', KNOWN)).toBe(false);
  });

  test('accepts plain strings too, treating them as files', () => {
    const { reachable, orphans } = partitionPhotoFiles(['attaboy.webp', 'ghost.webp'], KNOWN);
    expect(reachable).toEqual(['attaboy.webp']);
    expect(orphans).toEqual(['ghost.webp']);
  });
});

describe('assertDbIdsUsable — fail closed on a reachable-but-wrong database', () => {
  /**
   * The round-2 critical finding. The pruner threw only when DATABASE_URL was
   * UNSET; a wrong-but-reachable database answered successfully with too few rows,
   * and every DB-only venue silently left the known set. pencil-factory.webp is
   * the concrete casualty — the one file whose reachability rests solely on a DB
   * row. Connecting to a dead host was already fail-closed; THIS is the case that
   * was not, and it is the one a test can actually reach.
   */
  const REQUIRED = new Set(['pencil-factory']);

  test('throws on an empty result set', () => {
    expect(() => assertDbIdsUsable(new Set(), REQUIRED)).toThrow(/returned 0 rows/);
  });

  test('throws when a required DB-only venue is absent, naming it', () => {
    const wrongDb = new Set(['attaboy', 'the-bonnie']); // plausible size, wrong content
    expect(() => assertDbIdsUsable(wrongDb, REQUIRED)).toThrow(/pencil-factory/);
    expect(() => assertDbIdsUsable(wrongDb, REQUIRED)).toThrow(/false orphans/);
  });

  test('passes and returns the ids when the database is the right one', () => {
    const ok = new Set(['attaboy', 'pencil-factory']);
    expect(assertDbIdsUsable(ok, REQUIRED)).toBe(ok);
  });

  test('a non-empty set with no required ids configured still passes', () => {
    // If DB_ONLY_SIDECAR_IDS is ever emptied, the zero-row floor remains.
    const ok = new Set(['attaboy']);
    expect(assertDbIdsUsable(ok, new Set())).toBe(ok);
  });
});

describe('backupAndDeleteOrphans', () => {
  /**
   * The pruner's DELETE step, against a REAL temp directory. Until now the
   * classification logic was well covered while the code that actually removes
   * a user's files had none at all (GLM, G6 review). These assertions are
   * mostly NEGATIVE on purpose: what matters is not that orphans go, but that
   * nothing else does.
   */
  function makeDir(): { photoDir: string; backupDir: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'prune-delete-'));
    const photoDir = join(root, 'bar-photos');
    const backupDir = join(root, 'backup');
    mkdirSync(photoDir, { recursive: true });
    return { photoDir, backupDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test('deletes exactly the orphans and leaves everything else untouched', () => {
    const { photoDir, backupDir, cleanup } = makeDir();
    try {
      writeFileSync(join(photoDir, 'ghost.webp'), 'orphan-a');
      writeFileSync(join(photoDir, 'ghost-2.webp'), 'orphan-b');
      writeFileSync(join(photoDir, 'live-bar.webp'), 'reachable');
      writeFileSync(join(photoDir, 'notes.txt'), 'not an image');
      mkdirSync(join(photoDir, 'subdir'));

      const result = backupAndDeleteOrphans(photoDir, backupDir, ['ghost.webp', 'ghost-2.webp']);

      expect(result.deleted).toBe(2);
      const remaining = readdirSync(photoDir).sort();
      // The reachable image, the non-image and the DIRECTORY all survive.
      expect(remaining).toEqual(['live-bar.webp', 'notes.txt', 'subdir']);
    } finally {
      cleanup();
    }
  });

  test('every orphan is backed up, with its content intact, before deletion', () => {
    const { photoDir, backupDir, cleanup } = makeDir();
    try {
      writeFileSync(join(photoDir, 'a.webp'), 'content-a');
      writeFileSync(join(photoDir, 'b.png'), 'content-b');

      backupAndDeleteOrphans(photoDir, backupDir, ['a.webp', 'b.png']);

      expect(readdirSync(backupDir).sort()).toEqual(['a.webp', 'b.png']);
      // A backup that does not round-trip is not a backup.
      expect(readFileSync(join(backupDir, 'a.webp'), 'utf8')).toBe('content-a');
      expect(readFileSync(join(backupDir, 'b.png'), 'utf8')).toBe('content-b');
      expect(readdirSync(photoDir)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('reports the byte total it moved', () => {
    const { photoDir, backupDir, cleanup } = makeDir();
    try {
      writeFileSync(join(photoDir, 'a.webp'), '12345');
      writeFileSync(join(photoDir, 'b.webp'), '678');
      const result = backupAndDeleteOrphans(photoDir, backupDir, ['a.webp', 'b.webp']);
      expect(result.bytes).toBe(8);
    } finally {
      cleanup();
    }
  });

  test('an empty orphan list deletes nothing and creates no backup directory', () => {
    const { photoDir, backupDir, cleanup } = makeDir();
    try {
      writeFileSync(join(photoDir, 'live.webp'), 'keep me');

      const result = backupAndDeleteOrphans(photoDir, backupDir, []);

      expect(result).toEqual({ deleted: 0, bytes: 0 });
      expect(readdirSync(photoDir)).toEqual(['live.webp']);
      // No empty backup dir left behind on a clean run.
      expect(existsSync(backupDir)).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('a missing orphan aborts BEFORE any file is deleted (backup-first ordering)', () => {
    // The ordering is the whole safety property: if anything goes wrong while
    // backing up, nothing may have been unlinked yet. A stale entry in the
    // orphan list is the cheapest way to force that failure.
    const { photoDir, backupDir, cleanup } = makeDir();
    try {
      writeFileSync(join(photoDir, 'real.webp'), 'still here');

      expect(() =>
        backupAndDeleteOrphans(photoDir, backupDir, ['real.webp', 'vanished.webp']),
      ).toThrow();

      // real.webp was backed up but must NOT have been deleted, because the
      // unlink phase never started.
      expect(readdirSync(photoDir)).toEqual(['real.webp']);
    } finally {
      cleanup();
    }
  });
});
