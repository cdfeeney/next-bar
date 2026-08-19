import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which committed migration currently STATES a given function.
 *
 * Test-support only — nothing in the app imports this. It lives here rather
 * than inside one test file because two suites need the same answer and must
 * not drift: `nightOutsMigration.test.ts` reads the resolved file's TEXT, and
 * `nightOutsRls.live.test.ts` asserts that same file is in the serving
 * database's `public.schema_migrations` ledger. A copy in each would let the
 * static guard read one file while the ledger check vouched for another.
 */

export const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

/**
 * The functions whose effective SQL the static ordering guard reads.
 *
 * ONE list, because there were three: the inline literals in
 * nightOutsMigration.test.ts and two hand-kept copies in
 * nightOutsRls.live.test.ts (the signature pin and the ledger check). Adding a
 * fifth name to the static guard left both live controls silently covering four
 * of five, with nothing failing — the same remember-to-update-the-pointer
 * failure this module was extracted to end (round-2 review, Claude, medium).
 * Both live tests are now keyed on this array, so a name added here without a
 * signature entry fails to type-check.
 */
export const GUARDED_FUNCTIONS = [
  'respond_night_out',
  'join_night_out_by_token',
  'decline_night_out_by_token',
  'night_out_seat_count',
  'night_out_is_full_by_token',
] as const;

export type GuardedFunction = (typeof GUARDED_FUNCTIONS)[number];

/**
 * SQL as Postgres would read it, for text matching.
 *
 * Not a parser, and deliberately not the "SQL scanner" a previous round added
 * and then deleted — that one tried to DERIVE which file defines a function.
 * This one only normalises text; derivation is still the plain
 * highest-numbered-file rule below. Do not merge the two again.
 *
 * It does exactly three things, and each one closes a hole a reviewer landed:
 *
 *  - Removes comments, INCLUDING NESTED block comments, which Postgres nests and
 *    a non-greedy regex does not. The regex form stopped at the first `*​/` and
 *    left the code after it visible, so a lock call could be commented out of the
 *    database while still satisfying the guard (round-5 review, Codex, medium).
 *    Line comments matter just as much: this repo's own migration headers quote
 *    `create or replace function` in prose (0045:10, 0046:7), and the resolver
 *    read them (round-5 review, Claude, medium).
 *  - Blanks the CONTENTS of single-quoted literals, so `select 'create function
 *    public.respond_night_out'` is not a definition (round-5 review, Codex,
 *    medium). E-prefixed strings honour backslash escapes, so `E'Molly\'s'` ends
 *    where Postgres ends it — mis-lexing that one apostrophe flipped
 *    literal/code parity for the whole rest of the file, and every later quote
 *    then toggled the wrong way (round-6 review, both lanes, medium).
 *  - Understands DOLLAR QUOTES, tag and all. The outermost one is a function
 *    BODY and its contents are code — that is what these guards read. A nested
 *    one is a literal and is blanked in BOTH views, because
 *    `raise notice '%', $audit$pg_advisory_xact_lock(...)$audit$` only logs that
 *    text while satisfying the lock assertion (round-6 review, Codex, medium).
 *  - Lowercases everything EXCEPT literal contents. Identifiers and keywords are
 *    case-insensitive in Postgres, so lowercasing them prevents a false red;
 *    literals are not, so lowercasing THEM let a key of `'NIGHT_OUT_MEMBERS:'`
 *    take a different advisory lock while the guard still matched (round-5
 *    review, Codex, medium).
 *
 * Returns both views because they answer different questions: `code` keeps
 * single-quoted literals (the lock KEY is one), `skeleton` blanks them (a
 * definition is never inside one).
 *
 * WHAT IT IS NOT. It is not a Postgres parser, and a migration written to evade
 * it can still be written. What it defends is the accident — a function moving
 * files, a guard left pointing at dead text — not a hostile author, who has a
 * migration file and needs no cleverness. The authoritative controls are in
 * nightOutsRls.live.test.ts, which asks the database.
 */
export function sqlView(sql: string): { code: string; skeleton: string } {
  return scan(sql, false);
}

/**
 * One pass. `insideBody` says whether a dollar quote found here is a function
 * BODY (contents are code) or a nested literal (contents are inert text).
 */
function scan(sql: string, insideBody: boolean): { code: string; skeleton: string } {
  let code = '';
  let skeleton = '';
  let i = 0;

  /** Same length, newlines kept, so blanking cannot join two tokens. */
  const blank = (text: string) => {
    const spaces = text.replace(/[^\n]/g, ' ');
    code += spaces;
    skeleton += spaces;
  };
  /**
   * `$tag$` at `at`, or null.
   *
   * Not one that continues an identifier: `foo$guard$bar` is a legal Postgres
   * identifier, and reading its `$guard$` as an opener blanked through to the
   * next occurrence — deleting real code from the view and reddening a correct
   * migration (round-7 review, Codex, medium).
   */
  const dollarTag = (at: number): string | null => {
    if (at > 0 && /[A-Za-z0-9_$]/.test(sql[at - 1])) return null;
    return /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(at, at + 66))?.[0] ?? null;
  };

  while (i < sql.length) {
    if (sql.startsWith('/*', i)) {
      // Postgres NESTS block comments; a non-greedy regex stops at the first
      // inner terminator and leaves the rest visible.
      const start = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) { depth += 1; i += 2; continue; }
        if (sql.startsWith('*/', i)) { depth -= 1; i += 2; continue; }
        i += 1;
      }
      blank(sql.slice(start, i));
      continue;
    }

    if (sql.startsWith('--', i)) {
      const start = i;
      while (i < sql.length && sql[i] !== '\n') i += 1;
      blank(sql.slice(start, i));
      continue;
    }

    const tag = dollarTag(i);
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const inner = sql.slice(i + tag.length, close < 0 ? sql.length : close);
      const whole = sql.slice(i, close < 0 ? sql.length : close + tag.length);
      // A dollar quote is a function BODY only where Postgres puts one: right
      // after `AS`. Anywhere else it is an ordinary string — `select
      // $note$create or replace function public.respond_night_out(x)$note$;` is
      // a legal statement whose text was being exposed as code, so the resolver
      // picked a migration that defines nothing (round-7 review, Codex, medium).
      const isBody = !insideBody && /\bas\s*$/i.test(sql.slice(Math.max(0, i - 8), i));
      if (!isBody) {
        // Inert text: never executed, so it must not satisfy an assertion about
        // executable code, nor look like a definition.
        blank(whole);
      } else {
        const body = scan(inner, true);
        code += tag.toLowerCase() + body.code;
        skeleton += tag.toLowerCase() + body.skeleton;
        if (close >= 0) { code += tag.toLowerCase(); skeleton += tag.toLowerCase(); }
      }
      i += whole.length;
      continue;
    }

    if (sql[i] === "'") {
      // E'...' honours backslash escapes; a plain literal does not. Getting that
      // wrong at one apostrophe flipped literal/code parity for the whole rest
      // of the file, and every later quote then toggled the wrong way.
      const eString = /[eE]$/.test(sql.slice(0, i)) && !/[A-Za-z0-9_][eE]$/.test(sql.slice(0, i));
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (eString && sql[i] === '\\') { i += 2; continue; }
        // No branch for '' — deliberately. Closing at the first quote of the
        // pair and reopening at the second partitions the string identically:
        // the text between them is literal content either way, and an odd count
        // is malformed SQL. A reviewer asked for a test that pins that branch;
        // there is none, because there is no behaviour to pin — deleting it and
        // re-running left every test green (round-6 review, Claude, medium).
        // Do not add it back without a case that fails without it.
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      const literal = sql.slice(start, i);
      // `code` keeps contents AND their case — the advisory-lock key is a
      // literal, and 'NIGHT_OUT_MEMBERS:' is a different key. `skeleton` blanks
      // them, because a definition is never inside a string.
      code += literal;
      skeleton += literal.replace(/[^\n']/g, ' ');
      continue;
    }

    code += sql[i].toLowerCase();
    skeleton += sql[i].toLowerCase();
    i += 1;
  }
  return { code, skeleton };
}

/**
 * Where `name` is stated in `sql`, or -1.
 *
 * `create or replace` is optional because 0059 states get_night_out as
 * `drop function` + a plain `create function`. The schema qualifier is optional
 * and the whitespace is a run, because this used to be two exact byte-sequences:
 * a newline after `function`, two spaces, or a bare `create function
 * respond_night_out(` all returned -1, and definingMigration then resolved
 * BACKWARDS to the previous file and asserted against dead text with nothing
 * failing (round-3 review, Claude, medium). The open paren is still required so
 * get_night_out cannot hit get_night_out_board.
 */
export function definitionIndex(sql: string, name: string): number {
  return sql.search(
    new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${name}\s*\(`),
  );
}

/**
 * True when `sql` names `name` in the DEFINITION HEADER of a create-function
 * statement that this module nonetheless cannot read.
 *
 * A near-miss must be LOUD: silently skipping the file is what let the resolver
 * walk backwards to superseded text. But a FALSE near-miss is just as bad in the
 * other direction — it reds a correct repository, and the obvious repair under
 * time pressure is to delete this check, which reopens the hole.
 *
 * So the name must sit immediately after `function`, where a definition puts it,
 * and nowhere else. The first version allowed 200 characters of anything between
 * the two, which matched a migration that merely CALLED the function from inside
 * some other function's body — both lanes found it independently (round-4
 * review, Codex and Claude, medium). `language sql` definitions have no
 * semicolon before their body, so a bound on distance can never separate a
 * header from a body; only anchoring can.
 */
export function looksLikeUnreadableDefinition(sql: string, name: string): boolean {
  if (definitionIndex(sql, name) > -1) return false;
  // Same anchor as definitionIndex, minus the strictness that makes it readable:
  // any separator between the qualifier and the name, and no required open paren.
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?${name}\b`,
  ).test(sql);
}

/**
 * The filename of the highest-numbered COMMITTED migration that states `name`,
 * or null when nothing does.
 *
 * This is derived rather than hard-coded on purpose. Every previous version of
 * this lookup named its file literally, and the pointer went stale twice as
 * respond_night_out moved 0046 -> 0048 -> 0059 — each time leaving the ordering
 * invariants asserting against dead text with the suite green, which is the one
 * failure they exist to prevent (round-2 review, Claude, medium). A 0060
 * re-stating any of these functions now moves the guard by itself.
 *
 * What it resolves is the last file in the COMMITTED stream, which is the text
 * the database runs only when that stream is fully applied. This repo routinely
 * carries migrations numbered above the live ledger head (0059 says so in its
 * own header), so the forward direction is a real gap in the static guard, not
 * a hypothetical one — the ledger assertion in nightOutsRls.live.test.ts is
 * what closes it, on the one run that can see a database (round-1 review,
 * Claude, medium).
 *
 * Resolution is by NAME only. It cannot tell one overload from another, nor a
 * real removal from the routine drop of a superseded overload — both need
 * argument-type comparison, which text matching does not do. The control for
 * that is the live catalog probe in nightOutsRls.live.test.ts, which pins the
 * exact overload set of every name resolved here against pg_proc.
 */
export function definingMigration(name: string): string | null {
  // Files only: `revert/` is a subdirectory and its rollback text must never be
  // mistaken for the effective definition. Names are zero-padded, so lexical
  // order is numeric order.
  const defining: string[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    // The SKELETON: comments gone, literal contents blanked. Prose in a header
    // and a function name inside a string are not definitions, and reading the
    // raw text treated both as one (round-5 review, both lanes).
    const sql = sqlView(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')).skeleton;
    if (definitionIndex(sql, name) > -1) defining.push(file);
    else if (looksLikeUnreadableDefinition(sql, name)) {
      throw new Error(
        `${file} appears to define ${name} in a form this resolver cannot read. `
        + 'Refusing rather than resolving to an older file, which would guard dead text.',
      );
    }
  }
  return defining.length ? defining[defining.length - 1] : null;
}

/**
 * The checksum public.schema_migrations records for a migration.
 *
 * NORMALISED — fold CRLF to LF, then strip whitespace from the END OF THE
 * STRING; `/\s+$/` has no `m` flag, so a trailing space on an interior line is
 * kept. Stated precisely because "trailing-whitespace stripped" reads as
 * per-line, and an independent reimplementation from that description produces a
 * different digest (round-5 review, Claude, medium). It is what the ledger
 * actually holds, not a shortcut. The repo is developed on
 * Windows with core.autocrlf, so the same file hashes differently on two
 * checkouts and a raw-byte hash reports drift on every one of them.
 *
 * MEASURED, not assumed. Read directly from the serving staging ledger
 * (2026-08-19T02:00Z, the evening of 2026-08-18 local) before this function was
 * written, over all 55 schema_migrations rows: normalised matched all 35 rows
 * whose file exists on this branch with ZERO drift; raw bytes matched ZERO of
 * 35. The decisive single row is 0044_night_outs.sql, whose recorded checksum is
 * 3514e43e… — the normalised hash of the committed file, not its raw hash
 * (5578e1af…). The remaining 20 rows name files that live only on other
 * branches.
 *
 * THREE COMMITTED CLAIMS WERE WRONG ABOUT THIS, all in the same direction, and
 * all written by comparing raw bytes to a normalised ledger. The third was
 * missed when this list said two, and the corrected CLAUDE.md routed the reader
 * straight to it (round-6 review, Claude, medium):
 *   - scripts/apply-migration-set.ts said raw bytes were "the convention the
 *     existing ledger already uses (verified against 0044's recorded row)".
 *     0044's row is exactly what disproves it. That script now shares this
 *     algorithm, so the two cannot drift apart again (round-3 review, Claude,
 *     medium: an apply through it would have written rows this gate rejects).
 *   - CLAUDE.md said eleven 0000–0010 files "differ from the checksums recorded
 *     in the live ledger". Under the ledger's own algorithm they do not: all
 *     eleven are present and all eleven match. Corrected there.
 *   - scripts/apply-migrations.ts carried the same eleven-file sentence in its
 *     own header, and CLAUDE.md names that file by path. Corrected there too.
 *
 * WHAT THIS CAN AND CANNOT PROVE. Because it normalises, it proves a file is
 * identical to what was applied UP TO line endings and trailing whitespace — not
 * byte-for-byte. Byte identity is not provable from this ledger by anyone: the
 * only thing it records is this normalised digest, so there is no raw hash to
 * compare against (round-4 review, Codex, medium). Do not describe a passing
 * provenance test as proving byte identity.
 */
export function checksumOfSql(sql: string): string {
  return createHash('sha256')
    .update(sql.replace(/\r\n/g, '\n').replace(/\s+$/, ''), 'utf8')
    .digest('hex');
}

/**
 * The same checksum for a migration FILE, read from this module's own
 * MIGRATIONS_DIR.
 *
 * A caller that already holds the bytes must hash THOSE bytes with
 * checksumOfSql instead. apply-migration-set.ts learned that the hard way: it
 * executed a buffer read from its cwd-relative directory while recording a
 * checksum this function re-read from a __dirname-relative one, so running the
 * script by path from a second checkout applied one file and certified another
 * — and a second read is a second snapshot even within one checkout (round-4
 * review, Codex HIGH, corroborated by Claude).
 */
export function migrationChecksum(file: string): string {
  return checksumOfSql(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}
