import { createHash } from 'node:crypto';

/**
 * Decide which migrations to apply, given a ledger of what already ran.
 *
 * Why this exists: until now `apply-migrations.ts` re-ran EVERY .sql file on
 * every `npm run db:migrate`, relying on each file being idempotent. That has
 * two teeth:
 *
 *  1. Re-running 0020 re-creates and re-GRANTs the `pending_change_count(uuid)`
 *     function that 0021 exists to remove. Within one run the files apply in
 *     lexical order so it self-heals, but any window where 0020 ran and 0021
 *     did not leaves an over-permissive definer function live.
 *  2. Nothing detects an ALREADY-APPLIED migration being edited afterwards.
 *     That is the dangerous case: the file and the database silently disagree
 *     forever, and the next fresh environment gets different schema.
 *
 * So: hash every file, record it on success, skip it next time, and REFUSE to
 * run at all if a recorded file's contents changed. Drift is a hard stop, not
 * a warning — a warning in a script nobody watches is not a control.
 *
 * Pure and DB-free so it can actually be tested; the script owns the I/O.
 */

export type MigrationFile = { name: string; sql: string };

/** A row from the schema_migrations ledger. */
export type AppliedMigration = { name: string; checksum: string };

export type MigrationDrift = {
  name: string;
  recorded: string;
  current: string;
};

export type MigrationPlan = {
  /** Files to run, in lexical order. Empty when drift is present. */
  apply: MigrationFile[];
  /** Names already applied with matching checksums. */
  skip: string[];
  /** Applied files whose contents changed since. Non-empty ⇒ do not proceed. */
  drift: MigrationDrift[];
};

/**
 * SHA-256 of a migration's contents, normalised first.
 *
 * Line endings are normalised because this repo is developed on Windows with
 * `core.autocrlf` active — the same file can be read as CRLF on one machine and
 * LF on another. Hashing raw bytes would report drift on every checkout and
 * make the drift guard useless noise. A trailing-newline difference is likewise
 * not a schema change.
 */
export function checksum(sql: string): string {
  const normalised = sql.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

/**
 * Strip SQL comments before any structural analysis.
 *
 * Load-bearing, not hygiene: every migration in this repo ends with its rollback
 * statements in trailing `--` comments. Counting those as real DDL would invent
 * expectations that were never meant to execute, and the baseline guard below
 * would then refuse on a perfectly healthy database.
 */
/**
 * A dollar-quote opener at `index`, or null if `$` there is ordinary text.
 *
 * Shared by BOTH lexers deliberately — every bug in this file has come from two
 * hand-written scanners disagreeing about the same characters.
 *
 * Two PostgreSQL rules the naive `/^\$(\w*)\$/` version got wrong:
 *
 *  1. `$` is a legal character INSIDE an unquoted identifier (just not at the
 *     start). So `SELECT 1 AS foo$tag$;` is one identifier `foo$tag$`, NOT the
 *     alias `foo` followed by a dollar-quote. Treating it as an opener swallowed
 *     everything to the next `$tag$` and hid an executable ROLLBACK between them
 *     — fail open — while also wrongly refusing the perfectly valid single
 *     statement as an unterminated body. An opener therefore may not follow an
 *     identifier character.
 *  2. Tags follow identifier rules, which admit non-ASCII letters, so `$é$` is a
 *     valid tag. Rejecting it left the body to be scanned as ordinary SQL, where
 *     a stray quote or semicolon inside desynchronised everything after it.
 *
 * (Codex review, 2026-07-31.)
 */
function dollarQuoteTagAt(sql: string, index: number): string | null {
  if (sql[index] !== '$') return null;
  // Read the preceding CODE POINT, not the preceding UTF-16 code unit. For a
  // non-BMP identifier letter such as `𐐀`, `sql[index - 1]` is that character's
  // lone low surrogate, which is not `\p{L}` — so the guard below would pass and
  // `foo𐐀$tag$` would open a dollar quote after all, hiding an executable
  // ROLLBACK. Sharing one helper removed the two lexers' disagreement but made
  // them agree on the same wrong parse. (Codex review, 2026-07-31.)
  let previousIndex = index - 1;
  if (previousIndex > 0) {
    const unit = sql.charCodeAt(previousIndex);
    if (unit >= 0xdc00 && unit <= 0xdfff) previousIndex -= 1;
  }
  if (previousIndex >= 0) {
    const codePoint = sql.codePointAt(previousIndex);
    if (codePoint !== undefined && isIdentifierContinuation(codePoint)) return null;
  }
  return DOLLAR_TAG_RE.exec(sql.slice(index))?.[0] ?? null;
}

/**
 * PostgreSQL's own lexer (`scan.l`) defines
 *   ident_start [A-Za-z\200-\377_]
 *   ident_cont  [A-Za-z\200-\377_0-9\$]
 * — `\200-\377` is EVERY non-ASCII byte, not merely Unicode letters and digits.
 * So `foo😀` is a valid identifier and `foo😀$tag$` must not open a dollar quote.
 * A `\p{L}\p{N}` test misses emoji, symbols, punctuation and combining marks,
 * and each miss hides an executable ROLLBACK between the two apparent tags.
 * (Codex review, 2026-07-31.)
 */
function isIdentifierContinuation(codePoint: number): boolean {
  if (codePoint >= 0x80) return true;
  const char = String.fromCharCode(codePoint);
  return /[A-Za-z0-9_$]/.test(char);
}

/** A tag follows unquoted-identifier rules except that it cannot contain `$`. */
const DOLLAR_TAG_RE = /^\$(?:(?:[A-Za-z_]|[^\x00-\x7F])(?:[A-Za-z0-9_]|[^\x00-\x7F])*)?\$/u;

function stripSqlComments(sql: string): string {
  // PostgreSQL block comments NEST. A non-greedy `/\*[\s\S]*?\*\//` stops at the
  // FIRST `*/`, so `/* outer /* inner */ outer */ rollback;` was left as
  // `outer */ rollback` — which no longer matches `^rollback`, so the executable
  // ROLLBACK became invisible to transactionCommand and was passed through.
  // That is a fail-OPEN atomicity break, so this walks depth instead.
  // (Codex review, 2026-07-31.)
  // Both comment kinds must be consumed in ONE pass so whichever opens FIRST
  // wins. Stripping block comments first and line comments second lets
  // `-- /* not really a comment` open a block comment that never closes and
  // swallows the rest of the file — hiding an executable `rollback;` on the
  // next line. (Found while verifying the round-2 nesting fix, which introduced
  // exactly that regression; the previous regex pair did not have it.)
  // One state machine covering line comments, NESTED block comments, and string
  // /identifier/dollar-quoted literals. Three points, learned the hard way:
  //
  //  * whichever comment kind opens FIRST wins, so `-- /* x` must not open a
  //    block comment that swallows an executable ROLLBACK on the next line;
  //  * block comments nest, so `/* a /* b */ c */` must consume to the OUTER
  //    close, not the inner one;
  //  * literals must be skipped, because `select '/* /* */'` would otherwise
  //    leave depth elevated forever and hide every statement after it from
  //    both transactionCommand and expectedTablesFromMigrations.
  //
  // The last two interact: nesting without string-awareness is strictly worse
  // than neither, since a lone `/*` inside a literal used to self-heal at the
  // first `*/` and now cannot. (Codex + Claude review, 2026-07-31.)
  let out = '';
  let depth = 0;
  let mode: 'normal' | 'line' | 'single' | 'double' | 'dollar' = 'normal';
  let dollarTag = '';
  let escapedString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i] as string;

    if (mode === 'line') {
      if (char === '\n') {
        mode = 'normal';
        out += '\n';
      }
      continue;
    }
    if (depth > 0) {
      if (sql.startsWith('/*', i)) {
        depth += 1;
        i += 1;
      } else if (sql.startsWith('*/', i)) {
        depth -= 1;
        i += 1;
        if (depth === 0) out += ' ';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      const quote = mode === 'single' ? "'" : '"';
      out += char;
      // Inside E'...' a backslash escapes the next character, so E'O\'Brien'
      // does not end at the middle quote. Kept in step with topLevelStatements,
      // which already did this — two lexers over the same text disagreeing is
      // the recurring shape of every bug this function has had.
      if (escapedString && mode === 'single' && char === '\\') {
        if (i + 1 < sql.length) {
          out += sql[i + 1];
          i += 1;
        }
        continue;
      }
      if (char === quote) {
        if (sql[i + 1] === quote) {
          out += quote;
          i += 1;
        } else {
          mode = 'normal';
          escapedString = false;
        }
      }
      continue;
    }
    if (mode === 'dollar') {
      out += char;
      if (sql.startsWith(dollarTag, i)) {
        out += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        mode = 'normal';
      }
      continue;
    }

    if (sql.startsWith('--', i)) {
      mode = 'line';
      out += ' ';
      i += 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      mode = char === "'" ? 'single' : 'double';
      escapedString =
        mode === 'single' &&
        /[eE]/.test(sql[i - 1] ?? '') &&
        !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? '');
      out += char;
      continue;
    }
    const openTag = dollarQuoteTagAt(sql, i);
    if (openTag) {
      dollarTag = openTag;
      mode = 'dollar';
      out += openTag;
      i += openTag.length - 1;
      continue;
    }
    out += char;
  }
  return out;
}

type SqlStatementRange = { start: number; end: number; text: string };

/**
 * Split only on top-level semicolons. PL/pgSQL bodies are dollar-quoted and may
 * contain many `BEGIN`/`COMMIT`-looking tokens that must remain untouched.
 */
function topLevelStatements(sql: string): SqlStatementRange[] {
  const statements: SqlStatementRange[] = [];
  let start = 0;
  let mode: 'normal' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar' =
    'normal';
  let dollarTag = '';
  // PostgreSQL block comments NEST: `/* outer /* inner */ still a comment */`.
  // Exiting on the first `*/` would hand the rest of the comment back to the
  // scanner as executable text — a commented-out COMMIT would then read as real
  // transaction control. (Codex review, 2026-07-31.)
  let blockCommentDepth = 0;
  // Backslash escapes are only special inside E'' strings; with
  // standard_conforming_strings a backslash in an ordinary literal is data.
  let escapedString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        i += 1;
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = 'normal';
        i += 1;
      }
      continue;
    }
    if (mode === 'single') {
      if (escapedString && char === '\\') {
        i += 1;
      } else if (char === "'" && next === "'") {
        i += 1;
      } else if (char === "'") {
        mode = 'normal';
        escapedString = false;
      }
      continue;
    }
    if (mode === 'double') {
      if (char === '"' && next === '"') {
        i += 1;
      } else if (char === '"') {
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        mode = 'normal';
        i += dollarTag.length - 1;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      mode = 'line-comment';
      i += 1;
    } else if (char === '/' && next === '*') {
      mode = 'block-comment';
      blockCommentDepth = 1;
      i += 1;
    } else if (char === "'") {
      mode = 'single';
      // `E'...'` only — not the trailing `e` of an identifier or of a
      // type-prefixed literal such as `date'2026-07-31'`.
      escapedString =
        /[eE]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? '');
    } else if (char === '"') {
      mode = 'double';
    } else if (char === '$' && dollarQuoteTagAt(sql, i)) {
      dollarTag = dollarQuoteTagAt(sql, i) as string;
      mode = 'dollar';
      i += dollarTag.length - 1;
    } else if (char === ';') {
      statements.push({ start, end: i + 1, text: sql.slice(start, i + 1) });
      start = i + 1;
    }
  }

  if (start < sql.length) {
    statements.push({ start, end: sql.length, text: sql.slice(start) });
  }

  // Ending mid-literal or mid-comment means the scanner's view of the file
  // diverged from PostgreSQL's somewhere above, so every statement boundary
  // after that point is a guess. Refuse rather than guess: PostgreSQL rejects
  // unterminated literals and comments anyway, so no valid migration is lost,
  // and this can only ever over-reject — it cannot fail open.
  // (DeepSeek review, 2026-07-31.)
  // NOTE: `line-comment` at EOF is legal and common — every migration in this
  // repo ends with its rollback notes in trailing `--` comments, and the last
  // one need not be newline-terminated. Only unterminated LITERALS and BLOCK
  // comments indicate the scanner lost sync.
  if (mode === 'single' || mode === 'double' || mode === 'dollar') {
    throw new Error(
      `migration ends inside an unterminated ${
        mode === 'dollar' ? 'dollar-quoted body' : `${mode}-quoted literal`
      }`,
    );
  }
  if (mode === 'block-comment') {
    throw new Error('migration ends inside an unterminated block comment');
  }
  return statements;
}

/**
 * `begin` and `commit` are the only wrapper shapes this runner knows how to
 * remove. Every OTHER top-level transaction-control verb is reported as
 * `'other'` rather than ignored, because ignoring one fails OPEN: a migration
 * whose wrapper ends in `ROLLBACK` or the `COMMIT` alias `END` would previously
 * have been sent through verbatim, silently ending the runner's transaction
 * before its ledger INSERT — the exact atomicity break this function exists to
 * prevent. `savepoint`/`release`/`set transaction`/two-phase forms are equally
 * unsupported and must abort rather than be guessed at. (Codex review, 2026-07-31.)
 */
function transactionCommand(statement: string): 'begin' | 'commit' | 'other' | null {
  const executable = stripSqlComments(statement)
    .trim()
    .replace(/;\s*$/, '')
    .trim()
    .toLowerCase();
  if (/^begin(?:\s+(?:work|transaction))?$/.test(executable)) return 'begin';
  if (/^commit(?:\s+(?:work|transaction))?$/.test(executable)) return 'commit';
  // Anything else that STARTS with a transaction-control verb is unsupported and
  // must abort. Enumerating only the exact spellings left `COMMIT AND CHAIN`,
  // `COMMIT WORK AND NO CHAIN` and `BEGIN ISOLATION LEVEL ...` matching neither
  // the accepted forms nor the rejected list, so they returned null and were
  // executed verbatim. Matching on the leading verb closes that whole class
  // rather than chasing spellings. (Codex + DeepSeek review, 2026-07-31.)
  //
  // `set` is deliberately NOT a bare prefix: `set search_path = ...` is ordinary
  // and common in migrations. `prepare` likewise — only `PREPARE TRANSACTION` is
  // transaction control; `PREPARE name AS ...` is a prepared statement.
  if (
    /^(?:begin|start|commit|end|rollback|abort|savepoint|release|set\s+transaction|set\s+constraints|set\s+session\s+characteristics\s+as\s+transaction|prepare\s+transaction)\b/.test(
      executable,
    )
  ) {
    return 'other';
  }
  return null;
}

/**
 * Historical migrations 0029-0032 wrap themselves in BEGIN/COMMIT, while the
 * ledgered runner also owns the transaction. Sending the inner COMMIT verbatim
 * ends the runner transaction before its ledger INSERT, breaking the stated
 * atomicity guarantee. Remove only an OUTERMOST matched pair; dollar-quoted
 * function/DO bodies are preserved by the scanner above.
 */
export function unwrapMigrationTransaction(sql: string): {
  sql: string;
  unwrapped: boolean;
} {
  const meaningful = topLevelStatements(sql).filter(
    (statement) => stripSqlComments(statement.text).trim() !== '',
  );
  const controls = meaningful
    .map((statement, index) => ({ command: transactionCommand(statement.text), index }))
    .filter(
      (item): item is { command: 'begin' | 'commit' | 'other'; index: number } =>
        item.command !== null,
    );
  const unsupported = controls.find((item) => item.command === 'other');
  if (unsupported) {
    throw new Error(
      'migration contains an unsupported top-level transaction-control statement: ' +
        `${stripSqlComments(meaningful[unsupported.index]?.text ?? '').trim().slice(0, 60)}`,
    );
  }
  if (controls.length === 0) return { sql, unwrapped: false };

  const first = meaningful[0];
  const last = meaningful.at(-1);
  const firstCommand = first ? transactionCommand(first.text) : null;
  const lastCommand = last ? transactionCommand(last.text) : null;

  if (
    controls.length !== 2 ||
    controls[0]?.index !== 0 ||
    controls[0]?.command !== 'begin' ||
    controls[1]?.index !== meaningful.length - 1 ||
    controls[1]?.command !== 'commit' ||
    firstCommand !== 'begin' ||
    lastCommand !== 'commit' ||
    !first ||
    !last
  ) {
    throw new Error('migration contains unbalanced top-level transaction control');
  }

  return {
    sql: sql.slice(first.end, last.start),
    unwrapped: true,
  };
}

/**
 * `CREATE TABLE [IF NOT EXISTS] [schema.]name` — the optional schema group is
 * greedy so `public.bars` yields `bars`, not `public`.
 *
 * `CREATE TEMP TABLE` / `CREATE TEMPORARY TABLE` are excluded for free: the
 * intervening keyword means they never match `create\s+table`. That is
 * deliberate — a temp table is not evidence a migration ran.
 */
const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;

/**
 * Tables this migration set is expected to have created, lowercased, deduplicated,
 * in first-appearance order.
 *
 * Derived from the files rather than hardcoded so the baseline guard cannot go
 * stale as migrations are added — a hardcoded "does `bars` exist" check would
 * still pass on a database that stopped at migration 1.
 *
 * Known limits, stated rather than hidden: a table created inside a `DO $$`
 * block built by string concatenation is invisible here, and a table created by
 * one migration and dropped by a later one would be a false expectation. Neither
 * shape exists in this repo today; if one is added, this returns a weaker
 * signal, never a wrong ledger, because the guard only ever refuses.
 */
export function expectedTablesFromMigrations(
  files: readonly MigrationFile[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    // Same fail-closed guard `topLevelStatements` applies. Without it this
    // function silently DROPS every CREATE TABLE after an unterminated comment
    // or literal and hands the baseline check a short list — the two lexers
    // over the same text disagreeing yet again, which is the shape of every
    // bug this area has had. Such a file is invalid PostgreSQL and could never
    // have applied anywhere, so refusing costs nothing. (Claude review, 2026-07-31.)
    topLevelStatements(file.sql);
    const sql = stripSqlComments(file.sql);
    for (const m of sql.matchAll(CREATE_TABLE_RE)) {
      const name = m[1]?.toLowerCase();
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

export type BaselineCheck = {
  ok: boolean;
  /** Tables the migration files say should exist. */
  expected: string[];
  /** Expected tables absent from the database. Non-empty ⇒ refuse. */
  missing: string[];
  /** Set only when the premise could not be evaluated at all. */
  reason?: string;
};

/**
 * Verify the premise `--baseline` asserts: "every file on disk has already been
 * applied to this database."
 *
 * That cannot be proven in general — SQL is not introspectable to that depth —
 * but the catastrophic case can be refused outright. Pointed at a fresh database,
 * baseline would record all migrations as applied without running them, and the
 * next run would report "up to date" while no schema exists at all. Checking
 * every expected table also catches the partially-migrated case, not just the
 * empty one.
 *
 * Fails CLOSED when no expectation can be derived: no evidence of a migrated
 * database is not the same as evidence, and a guard that passes vacuously is not
 * a guard.
 */
export function checkBaselinePremise(
  files: readonly MigrationFile[],
  existingTables: readonly string[],
): BaselineCheck {
  const expected = expectedTablesFromMigrations(files);
  if (expected.length === 0) {
    return {
      ok: false,
      expected,
      missing: [],
      reason:
        'no expectation could be derived from the migration files, so the baseline premise cannot be verified',
    };
  }
  const have = new Set(existingTables.map((t) => t.toLowerCase()));
  const missing = expected.filter((t) => !have.has(t));
  return { ok: missing.length === 0, expected, missing };
}

export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const recorded = new Map(applied.map((a) => [a.name, a.checksum]));

  const apply: MigrationFile[] = [];
  const skip: string[] = [];
  const drift: MigrationDrift[] = [];

  for (const file of files) {
    const current = checksum(file.sql);
    const previous = recorded.get(file.name);

    if (previous === undefined) {
      apply.push(file);
    } else if (previous === current) {
      skip.push(file.name);
    } else {
      drift.push({ name: file.name, recorded: previous, current });
    }
  }

  // Fail closed: if ANY applied migration was edited, run nothing. Applying
  // the untouched remainder would leave the schema in a state no single
  // commit describes, which is worse than doing nothing and saying so.
  return drift.length > 0 ? { apply: [], skip, drift } : { apply, skip, drift };
}
