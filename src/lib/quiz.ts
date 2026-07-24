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
    options: [
      'FiDi',
      'LES',
      'East Village',
      'West Village',
      'Chelsea',
      'Midtown',
      'UWS',
      'UES',
    ],
  },
];

export function deriveArchetype(tags: VibeTag[]): string {
  const has = (tag: VibeTag) => tags.includes(tag);

  if (has('dive') && has('locals')) return 'Dive devotee';
  if (has('cocktail') && has('polished')) return 'Cocktail connoisseur';
  if (has('speakeasy') && has('romantic')) return 'Hidden-door romantic';
  if (has('dance') && has('house')) return 'Late-night dancefloor';
  if (has('jazz') && has('lounge')) return 'Jazz lounge sophisticate';
  if (has('rough') && has('cheap')) return 'No-frills regular';
  if (has('trendy') && has('instagrammable')) return 'New-wave trendsetter';
  if (has('industry') && has('cocktail')) return 'Industry-crowd insider';
  if (has('rooftop')) return 'Skyline-view chaser';
  if (has('garden') && has('chill')) return 'Backyard session regular';
  if (has('wine') && has('romantic')) return 'Wine-bar romantic';
  return 'NYC vibe explorer';
}
