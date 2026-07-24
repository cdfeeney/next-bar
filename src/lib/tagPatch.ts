/**
 * B5c-3 review-mining apply-tool core: surgical textual edits to the
 * one-line `tags: [...]` arrays in the hand-authored bars.*.ts files.
 *
 * Textual (not AST) on purpose: the catalog files are uniformly formatted
 * single-line tag arrays, and a text transform keeps the diff to exactly
 * the changed line — no reformatting noise in review. Every failure mode
 * throws with the bar id so the CLI can abort the whole run (apply is
 * all-or-nothing per invocation; the caller re-runs after fixing input).
 */

export type TagAction = 'add' | 'remove';

/**
 * Return `source` with `tag` added to / removed from the tags array of
 * the bar whose `id: '<barId>'` line appears in it. Throws when the bar
 * is missing, the tags line can't be found in that bar's block, or the
 * change is a no-op (add of a present tag / remove of an absent one) —
 * a no-op means the input list is stale and must not be silently eaten.
 */
export function applyTagChange(
  source: string,
  barId: string,
  action: TagAction,
  tag: string,
): string {
  const idNeedle = `id: '${barId}',`;
  const idAt = source.indexOf(idNeedle);
  if (idAt === -1) {
    throw new Error(`bar '${barId}' not found in source`);
  }
  if (source.indexOf(idNeedle, idAt + 1) !== -1) {
    throw new Error(`bar '${barId}' appears more than once in source`);
  }

  // The bar's block ends where the next entry begins (or EOF): the tags
  // line we edit must sit before that boundary.
  const nextIdAt = source.indexOf("id: '", idAt + idNeedle.length);
  const blockEnd = nextIdAt === -1 ? source.length : nextIdAt;

  const tagsMatch = /tags: \[([^\]]*)\],/.exec(source.slice(idAt, blockEnd));
  if (!tagsMatch || tagsMatch.index === undefined) {
    throw new Error(`bar '${barId}': tags line not found in its block`);
  }

  const tags = [...tagsMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (action === 'add') {
    if (tags.includes(tag)) {
      throw new Error(`bar '${barId}': tag '${tag}' already present`);
    }
    tags.push(tag);
  } else {
    if (!tags.includes(tag)) {
      throw new Error(`bar '${barId}': tag '${tag}' not present`);
    }
    tags.splice(tags.indexOf(tag), 1);
  }

  const rebuilt = `tags: [${tags.map((t) => `'${t}'`).join(', ')}],`;
  const absoluteStart = idAt + tagsMatch.index;
  return (
    source.slice(0, absoluteStart) +
    rebuilt +
    source.slice(absoluteStart + tagsMatch[0].length)
  );
}
