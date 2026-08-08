/**
 * Path-glob matching for the repository-owned tier classifier.
 *
 * Zero runtime dependencies (Node built-ins only) so `scripts/tier-classify.mjs`
 * can run in CI before `npm ci`, and so the tier gate can never be disabled by a
 * dependency resolution failure.
 *
 * Ported from the harness classifier at `~/.claude/lib/tier-classify.mjs`, which
 * this repository previously depended on. That file lives outside the repo, so CI
 * could not invoke it and there was effectively no tier validation in CI.
 *
 * Deliberately NOT a RegExp. A backtracking regex compiled from a glob with
 * multiple unbounded wildcards (e.g. `*?*?*`) can backtrack catastrophically
 * against a non-matching path. Globs come from a config file that may be
 * typo'd, so the matcher must be safe by construction, not by trusting input.
 */

/**
 * Compile a path glob into a token list for the linear matcher.
 *
 * Tokens: `gss` = `**` + `/` (zero or more leading directories),
 * `globstar` = `**` (any chars including `/`), `star` = `*` (any run except
 * `/`), `any1` = `?` (single non-`/`), `lit` = a literal character.
 *
 * @param {string} glob
 * @returns {Array<{t:string, c?:string}>}
 */
export function compileGlob(glob) {
  const s = String(glob).replace(/\*{2,}/g, '**'); // a run of stars is equivalent to `**`
  const tokens = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') {
      if (s[i + 1] === '*') {
        if (s[i + 2] === '/') {
          tokens.push({ t: 'gss' }); // `**/` — the trailing slash belongs to this token
          i += 2;
        } else {
          tokens.push({ t: 'globstar' });
          i += 1;
        }
      } else {
        tokens.push({ t: 'star' });
      }
    } else if (c === '?') {
      tokens.push({ t: 'any1' });
    } else {
      tokens.push({ t: 'lit', c });
    }
  }
  return tokens;
}

/**
 * Match a path against compiled glob tokens with a memoized DP — guaranteed
 * polynomial (no backtracking blowup) for any input.
 *
 * Iterative on purpose: a recursive form unrolls O(path length) deep and would
 * blow the stack on a long path. This can never overflow or hang. O(n*m).
 *
 * @param {Array<{t:string,c?:string}>} tokens
 * @param {string} path
 * @returns {boolean}
 */
export function matchTokens(tokens, path) {
  const p = String(path);
  const n = tokens.length;
  const m = p.length;
  // next[pi] = can tokens[ti+1..] match path[pi..] — starts as the ti === n base row.
  let next = new Array(m + 1);
  for (let pi = 0; pi <= m; pi++) next[pi] = pi === m;
  const gss = new Array(m + 1); // `**/` body row, reused per gss token
  for (let ti = n - 1; ti >= 0; ti--) {
    const tok = tokens[ti];
    const cur = new Array(m + 1);
    if (tok.t === 'gss') {
      // body: a prefix ending in a slash. gss[pi] depends on gss[pi+1] and next[pi+1].
      gss[m] = false;
      for (let pi = m - 1; pi >= 0; pi--) {
        gss[pi] = p[pi] === '/' ? next[pi + 1] || gss[pi + 1] : gss[pi + 1];
      }
      for (let pi = m; pi >= 0; pi--) cur[pi] = next[pi] || (pi < m && gss[pi]);
    } else {
      for (let pi = m; pi >= 0; pi--) {
        switch (tok.t) {
          case 'lit':
            cur[pi] = pi < m && p[pi] === tok.c && next[pi + 1];
            break;
          case 'any1':
            cur[pi] = pi < m && p[pi] !== '/' && next[pi + 1];
            break;
          case 'star': // any run of non-`/`
            cur[pi] = next[pi] || (pi < m && p[pi] !== '/' && cur[pi + 1]);
            break;
          case 'globstar': // any run including `/`
            cur[pi] = next[pi] || (pi < m && cur[pi + 1]);
            break;
          default:
            cur[pi] = false;
        }
      }
    }
    next = cur;
  }
  return next[0];
}

/** Convenience: compile + match in one call. */
export function globMatch(glob, path) {
  return matchTokens(compileGlob(glob), path);
}

/**
 * Normalize a repo-relative path for matching.
 *
 * Windows/CI compatibility (the operator develops on Windows, CI runs Linux):
 * `\` becomes `/`, a leading `./` is stripped, and a leading `/` is dropped so
 * an absolute-looking entry still matches a repo-relative glob. Case is NOT
 * folded here — see `matchesAnyGlob` for the case-insensitive-filesystem rule.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * Match a path against a list of globs, case-insensitively.
 *
 * Case-insensitive on purpose: on Windows and macOS `Scripts/Purge.mjs` and
 * `scripts/purge.mjs` are the SAME file, so a case-sensitive gate could be
 * evaded — or, worse, silently disagree between a developer's machine and CI.
 * Lower-casing both sides makes the result identical on every platform.
 *
 * @param {string[]} globs
 * @param {string} path
 * @returns {string|null} the first matching glob, or null
 */
export function matchesAnyGlob(globs, path) {
  const p = normalizePath(path).toLowerCase();
  for (const g of globs) {
    if (globMatch(String(g).toLowerCase(), p)) return g;
  }
  return null;
}
