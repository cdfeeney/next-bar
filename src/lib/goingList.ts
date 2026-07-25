/**
 * Going-list display grammar for tonight's suggestions (PR #14 review
 * LOW): past GOING_LIST_MAX_NAMES names the list used to rely on CSS
 * `truncate`, clipping mid-name and eating the "are in" verb. Bounded
 * text instead: "You, Claire, Sam +2 others are in".
 */

export const GOING_LIST_MAX_NAMES = 3;

/** "Claire is in" · "You are in" · "You, Claire, Sam +2 others are in" */
export function formatGoingList(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  const shown = labels.slice(0, GOING_LIST_MAX_NAMES);
  const extra = labels.length - shown.length;
  const names =
    extra > 0
      ? `${shown.join(', ')} +${extra} ${extra === 1 ? 'other' : 'others'}`
      : shown.join(', ');
  // Singular only for a single non-"You" name ("Claire is in"); "You are
  // in" and every multi-person list read as plural.
  const verb = labels.length === 1 && labels[0] !== 'You' ? 'is' : 'are';
  return `${names} ${verb} in`;
}
