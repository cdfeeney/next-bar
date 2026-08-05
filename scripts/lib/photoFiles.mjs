/**
 * Which files in public/bar-photos/ a live venue can actually request.
 *
 * Extracted from scripts/prune-orphan-photos.mjs so it can be imported by a test.
 * That script has top-level side effects (`refuseIfUnattended`, `await main()`), so
 * importing it would RUN it — the same reason the sidecar invariants had to move
 * out of refresh-places.mjs. santa-loop round 2 flagged the new destructive script
 * as having no tests at all, which was fair: the rigor went to the module it
 * replaced and not to the code that actually deletes files.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Extensions the photo pipeline produces. PHOTO_EXT is 'webp' since 2026-07-27. */
export const IMAGE_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'];

/** Highest carousel index the ingest ever writes. photo_count maxes at 3 today. */
export const MAX_PHOTO_INDEX = 8;

const EXT_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');

/** True for a filename the photo pipeline could have produced. */
export function isImageFilename(name) {
  return EXT_RE.test(name);
}

export function stripExtension(name) {
  return name.replace(EXT_RE, '');
}

/**
 * Reachable iff the basename IS a known venue id, or is `<known-id>-<n>` where the
 * PREFIX is itself known and n is a real carousel index.
 *
 * Exact match is tried FIRST and wins. That ordering is load-bearing: with both
 * `bar` and `bar-54` as known ids, `bar-54.webp` must resolve as the venue
 * `bar-54`, not as photo #54 of `bar`. An earlier version stripped any trailing
 * `-<digits>` before looking anything up, which would have deleted the photos of
 * every live venue whose id ends in a number — sunswick-3535, studio-151, dive-75,
 * bar-54, terminal-5. It never ran, but only by luck.
 *
 * Note the rule is deliberately one-directional: it can only ever be satisfied by
 * a prefix that is ALREADY a known venue, so an unknown id cannot borrow
 * reachability from a numeric suffix.
 */
export function isReachable(basename, known, maxIndex = MAX_PHOTO_INDEX) {
  if (known.has(basename)) return true;
  const m = /^(.*)-(\d+)$/.exec(basename);
  if (!m) return false;
  const n = Number(m[2]);
  return known.has(m[1]) && n >= 2 && n <= maxIndex;
}

/**
 * Partition directory entries into deletable orphans, reachable files, and
 * anything that is not a plain image file.
 *
 * `entries` are fs.Dirent objects. Non-files and non-images are returned under
 * `skipped` and NEVER offered for deletion: a subdirectory used to crash the
 * delete loop at copyFileSync (EISDIR) after some files had already been backed
 * up, and a stray non-image would have been deleted purely because its name did
 * not look like a venue id.
 */
export function partitionPhotoFiles(entries, known, maxIndex = MAX_PHOTO_INDEX) {
  const reachable = [];
  const orphans = [];
  const skipped = [];

  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const isFile = typeof entry === 'string' ? true : entry.isFile();

    if (!isFile || !isImageFilename(name)) {
      skipped.push(name);
      continue;
    }
    (isReachable(stripExtension(name), known, maxIndex) ? reachable : orphans).push(name);
  }

  return { reachable, orphans, skipped };
}

/**
 * Refuse a `bars` result set that cannot be the database we think it is.
 *
 * santa-loop round 2, both reviewers: the pruner previously threw only when
 * DATABASE_URL was UNSET. A reachable-but-wrong database — empty, un-migrated, or
 * a different project — answered the query successfully with too few rows, and
 * every DB-only venue silently dropped out of the known set. `pencil-factory.webp`
 * is the concrete casualty: the one file whose reachability rests solely on a DB
 * row. Backing up before deleting made that recoverable, not correct.
 *
 * Checks identity rather than a row-count heuristic: `requiredIds` names exactly
 * the venues whose photos depend on the database being right, so their absence is
 * proof this is the wrong database rather than a guess about size.
 *
 * Throws on failure; returns the id Set on success.
 */
export function assertDbIdsUsable(ids, requiredIds) {
  if (ids.size === 0) {
    throw new Error(
      'public.bars returned 0 rows. Refusing to run: this DATABASE_URL almost ' +
        'certainly points at the wrong or an un-migrated database, and every ' +
        "DB-only venue's photos would look like orphans.",
    );
  }
  const missing = [...requiredIds].filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(
      `public.bars is missing known DB-only venue(s): ${missing.join(', ')}. ` +
        'Refusing to run — their photo files would be deleted as false orphans.',
    );
  }
  return ids;
}

/**
 * Back up, then delete, the orphan files — the destructive half of
 * scripts/prune-orphan-photos.mjs.
 *
 * Extracted so it can be tested against a real directory. It previously lived
 * inline in main(), which meant the ONE step that actually removes a user's
 * files was the one step with no coverage: partitionPhotoFiles decided WHAT to
 * delete and was well tested, while the deleting itself was not exercised at
 * all. Raised by GLM during the G6 review.
 *
 * TWO PHASES, and the order is load-bearing: every backup is written BEFORE
 * any unlink. A subdirectory once crashed the old combined loop at
 * copyFileSync (EISDIR) after part of the backup had been written, which is
 * how you end up with files deleted whose backups never landed. Callers must
 * pass an already-classified `orphans` list (see partitionPhotoFiles) — this
 * function does no classification of its own and deletes exactly what it is
 * given, nothing more.
 *
 * PRECONDITION: `orphans` must be bare basenames from partitionPhotoFiles()
 * applied to `photoDir`. This function does not re-classify — the caller owns
 * "what is an orphan". It DOES enforce the shape of what it is handed, because
 * a function that deletes a user's files must not depend on an undocumented
 * convention for its safety.
 *
 * @param {string} photoDir  directory holding the photos
 * @param {string} backupDir directory to copy orphans into (created if needed);
 *                           must NOT be inside photoDir
 * @param {string[]} orphans bare basenames to back up and delete
 * @param {(msg: string) => void} [log] injected so tests can capture the
 *                           inter-phase confirmation; defaults to console.log
 * @returns {{ deleted: number, bytes: number }}
 * @throws if any entry is not a bare filename, or backupDir is inside photoDir
 */
export function backupAndDeleteOrphans(photoDir, backupDir, orphans, log = console.log) {
  if (orphans.length === 0) return { deleted: 0, bytes: 0 };

  // VALIDATE EVERYTHING BEFORE MUTATING ANYTHING (GLM + Kimi review).
  // This is a SHAPE check, not a re-run of the venue-id classifier — it does
  // not stat, read directories, or decide what an orphan is. It only refuses
  // an entry that is not a bare filename. Without it, one caller passing
  // '../../something.jpg' would copy AND DELETE a file outside photoDir, and
  // the only thing standing between this exported function and that outcome
  // was the convention that its sole caller happens to pass basenames.
  // Deliberately throws rather than skipping: a bad entry is a programming
  // error, and silently filtering it is the "silent divergence" the other
  // reviewer rightly warned about. Running before mkdir/copy/unlink means a
  // violation leaves ZERO side effects.
  for (const f of orphans) {
    if (typeof f !== 'string' || f === '' || f !== path.basename(f)) {
      throw new Error(
        `refusing to delete: orphan entry is not a bare filename: ${JSON.stringify(f)}`,
      );
    }
  }

  // A backupDir inside photoDir would be classified as orphans on the NEXT
  // run and deleted — the safety net eating itself. Reachable today only via
  // the operator's --backup-dir flag, which is exactly when a typo happens.
  const resolvedPhotoDir = path.resolve(photoDir);
  const resolvedBackupDir = path.resolve(backupDir);
  if (
    resolvedBackupDir === resolvedPhotoDir ||
    resolvedBackupDir.startsWith(resolvedPhotoDir + path.sep)
  ) {
    throw new Error(
      `refusing to delete: backupDir must not be inside photoDir (${resolvedBackupDir})`,
    );
  }

  fs.mkdirSync(backupDir, { recursive: true });
  let bytes = 0;
  for (const f of orphans) {
    const src = path.join(photoDir, f);
    bytes += fs.statSync(src).size;
    fs.copyFileSync(src, path.join(backupDir, f));
  }

  // The inter-phase line is NOT cosmetic (Codex + Kimi review). It is the
  // operator's confirmation that every backup landed before anything
  // irreversible starts, and it marks the point of no return in the log. The
  // extraction had moved it after the deletes, so a crash mid-delete left no
  // record that a backup existed — the worst possible state for recovery.
  // Injected rather than hard-wired to console.log so tests can capture it;
  // kept INSIDE this function rather than splitting the phases into two
  // exports, because splitting would ship a delete primitive with no backup
  // guarantee.
  log(`\nbacked up ${orphans.length} files (${(bytes / 1024).toFixed(0)} KB) to ${backupDir}`);

  // Phase 2 — only now that every backup exists.
  for (const f of orphans) fs.unlinkSync(path.join(photoDir, f));

  return { deleted: orphans.length, bytes };
}
