import type { ManhattanNeighborhood, VibeTag } from '@/types';

export type QuizOption = { label: string; tags: VibeTag[] };

export type SinglePickQuestion = {
  kind: 'single';
  prompt: string;
  options: QuizOption[];
};

export type NeighborhoodMultiSelectQuestion = {
  kind: 'neighborhoodMultiSelect';
  prompt: string;
  skipLabel: string;
  doneLabel: string;
  options: ManhattanNeighborhood[];
};

export type QuizQuestion = SinglePickQuestion | NeighborhoodMultiSelectQuestion;

export const quiz: QuizQuestion[] = [
  {
    kind: 'single',
    prompt: 'Friday, 11pm. What sounds good?',
    options: [
      { label: 'A dive with a jukebox', tags: ['dive', 'rough', 'old-nyc'] },
      { label: 'A hidden cocktail spot', tags: ['speakeasy', 'cocktail', 'polished'] },
      // Tag-audit F2 (2026-07-25): beer(76 bars)/pub(44)/wine(20) were
      // quiz-inexpressible — the two biggest gaps in the catalog.
      { label: 'Cold pints at a proper pub', tags: ['pub', 'beer'] },
      { label: 'A good glass of wine', tags: ['wine', 'chill'] },
    ],
  },
  {
    kind: 'single',
    prompt: 'What energy are you bringing?',
    options: [
      { label: 'Loud — bring the noise', tags: ['loud', 'buzzy'] },
      { label: 'Mellow — we wanna talk', tags: ['chill'] },
    ],
  },
  {
    kind: 'single',
    // Setting axis (2026-07-24): garden(25 bars)/rooftop(20) were the last
    // big quiz-inexpressible tags — 45 outdoor-space bars no new user
    // could ask for. "Inside" keeps the pick honest for the default case.
    prompt: 'Where do you wanna be?',
    options: [
      { label: 'A backyard or garden', tags: ['garden', 'chill'] },
      { label: 'A rooftop with views', tags: ['rooftop', 'instagrammable'] },
      { label: 'Tucked away inside', tags: ['lounge', 'speakeasy'] },
      { label: 'On a dance floor', tags: ['club', 'dance'] },
    ],
  },
  {
    kind: 'single',
    prompt: 'Soundtrack of the night?',
    options: [
      { label: 'Indie / rock', tags: ['indie', 'rough'] },
      // Tag-audit F1 (2026-07-25): 'hiphop' tags ZERO bars — an emittable
      // dead tag only diluted Jaccard. Danceable intent now maps to the
      // coverage that exists (dance 13, house 5, loud); re-add a hip-hop
      // answer when B5c review-mining actually tags hip-hop rooms.
      { label: 'DJs & dancing', tags: ['dance', 'house', 'loud'] },
      // 'live' (29 bars) was inexpressible — audit F6.
      { label: 'Live music', tags: ['live', 'jazz'] },
      { label: 'Jazz / lounge', tags: ['jazz', 'lounge'] },
    ],
  },
  {
    kind: 'single',
    prompt: 'Who do you wanna be around?',
    options: [
      { label: 'Locals & regulars', tags: ['locals', 'old-nyc', 'dive'] },
      { label: 'Trendy and lively', tags: ['trendy', 'instagrammable'] },
      { label: 'Industry / creative', tags: ['industry', 'cocktail'] },
    ],
  },
  {
    kind: 'single',
    // Tag-audit F2 (2026-07-25): 'date'(84 bars!)/'romantic'(24)/
    // 'post-work'(38) were the biggest quiz-inexpressible tags — a core
    // bar-choice mode the matcher could never hear about.
    prompt: 'Who are you out with?',
    options: [
      { label: 'On a date', tags: ['date', 'romantic', 'cocktail'] },
      { label: 'Post-work crew', tags: ['post-work', 'beer'] },
      { label: 'The whole group, going late', tags: ['buzzy', 'loud', 'dance'] },
      { label: 'Solo or one good friend', tags: ['chill', 'locals'] },
    ],
  },
  {
    kind: 'single',
    prompt: 'Spending vibe tonight?',
    options: [
      { label: 'Cheap and cheerful', tags: ['cheap', 'dive'] },
      { label: 'Solid middle', tags: ['mid'] },
      { label: 'Treating myself', tags: ['pricey', 'cocktail'] },
      // splurge(10 bars) was quiz-inexpressible — audit F2 tail.
      { label: 'Big night, no limits', tags: ['splurge', 'polished'] },
    ],
  },
  {
    kind: 'neighborhoodMultiSelect',
    prompt: 'Any neighborhoods you love?',
    skipLabel: 'Anywhere works',
    doneLabel: 'Done',
    // Full service area (2026-07-24): the picker was Manhattan-only-8 for
    // historical reasons while the catalog served 12 hoods — now it lists
    // everything, and "Anywhere works" stays the honest default.
    options: [
      'FiDi',
      'LES',
      'SoHo',
      'East Village',
      'West Village',
      'Chelsea',
      'Midtown',
      "Hell's Kitchen",
      'UWS',
      'UES',
      'Harlem',
      'Tribeca',
      'Battery Park City',
      'Hamilton Heights',
      'Flatiron',
      'Greenwich Village',
      'NoHo',
      'Hudson Square',
      'Gramercy',
      'Kips Bay',
      'East Harlem',
      'Morningside Heights',
      'Washington Heights',
      'Inwood',
      'Chinatown',
      'Williamsburg',
      'Greenpoint',
      'Bushwick',
      'Park Slope',
      'Fort Greene',
      'Gowanus',
      'Astoria',
      'LIC',
      'Ridgewood',
    ],
  },
];

/**
 * The user-facing label for a taste profile.
 *
 * S2 (operator): the old labels read like a market-research segment —
 * "Industry-crowd insider", "Jazz lounge sophisticate", "Backyard session
 * regular". Two problems. They were stiff and long enough to wrap on the
 * mobile surfaces that show them, and a few implied an in-crowd the reader
 * either belongs to or doesn't ("insider", "connoisseur", "sophisticate").
 * A label the user sees about themselves should sound like something a friend
 * would say, not a segment they've been sorted into.
 *
 * BRANCH ORDER AND PREDICATES ARE UNCHANGED — only the returned strings moved.
 * The ordering is load-bearing: `cocktail + polished` is tested before
 * `industry + cocktail`, so someone with all three reads as the cocktail
 * branch. Every label is <= 21 characters, under the previous longest (24,
 * "Jazz lounge sophisticate"), so nothing that fitted before can wrap now.
 */
export function deriveArchetype(tags: VibeTag[]): string {
  const has = (tag: VibeTag) => tags.includes(tag);

  if (has('dive') && has('locals')) return 'Dive regular';
  if (has('cocktail') && has('polished')) return 'Cocktail lover';
  if (has('speakeasy') && has('romantic')) return 'Hidden-door romantic';
  if (has('dance') && has('house')) return 'Here for the dancing';
  if (has('jazz') && has('lounge')) return 'Slow night, live jazz';
  if (has('rough') && has('cheap')) return 'Cheap and cheerful';
  if (has('trendy') && has('instagrammable')) return 'Always somewhere new';
  // "Knows the bartender" was the first attempt here and a reviewer rightly
  // rejected it: framing the label around privileged access to staff keeps the
  // in-crowd implication this rewrite exists to remove. Describe the occasion
  // instead of the connection.
  if (has('industry') && has('cocktail')) return 'Cocktails after hours';
  if (has('rooftop')) return 'Up where the view is';
  // Names only what the predicate actually tests. An earlier draft said
  // "Backyard and a beer", which invents a drink preference — and read as a
  // flat contradiction for anyone whose tags included wine.
  if (has('garden') && has('chill')) return 'Garden seat, no rush';
  if (has('wine') && has('romantic')) return 'Wine and low light';
  return 'Still exploring NYC';
}
