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
    prompt: 'Soundtrack of the night?',
    options: [
      { label: 'Indie / rock', tags: ['indie', 'rough'] },
      { label: 'Hip-hop', tags: ['hiphop', 'buzzy'] },
      { label: 'House / EDM', tags: ['house', 'dance'] },
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
    prompt: 'Spending vibe tonight?',
    options: [
      { label: 'Cheap and cheerful', tags: ['cheap', 'dive'] },
      { label: 'Solid middle', tags: ['mid'] },
      { label: 'Treating myself', tags: ['pricey', 'cocktail'] },
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
  if (has('wine') && has('romantic')) return 'Wine-bar romantic';
  return 'NYC vibe explorer';
}
