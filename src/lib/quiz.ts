import type { VibeTag } from '@/types';

export type QuizOption = { label: string; tags: VibeTag[] };
export type QuizQuestion = { prompt: string; options: QuizOption[] };

export const quiz: QuizQuestion[] = [
  {
    prompt: 'Friday, 11pm. You want…',
    options: [
      { label: 'A dive with a jukebox', tags: ['dive', 'rough', 'old-nyc'] },
      { label: 'A speakeasy with $22 cocktails', tags: ['speakeasy', 'cocktail', 'polished'] },
    ],
  },
  {
    prompt: 'How loud should it be?',
    options: [
      { label: 'Yelling over the music', tags: ['loud', 'buzzy'] },
      { label: 'Quiet enough to hear each other', tags: ['chill'] },
    ],
  },
  {
    prompt: 'Best part of a bar is…',
    options: [
      { label: 'The crowd', tags: ['buzzy', 'post-work'] },
      { label: 'The drinks', tags: ['cocktail', 'wine'] },
    ],
  },
  {
    prompt: 'Lights.',
    options: [
      { label: 'Dim — can barely see', tags: ['rough', 'romantic'] },
      { label: 'Bright and alive', tags: ['buzzy', 'pub'] },
    ],
  },
  {
    prompt: 'How you arrive.',
    options: [
      { label: 'Walk in, no plan', tags: ['dive', 'pub', 'locals'] },
      { label: 'Reservation, dressed up', tags: ['cocktail', 'polished', 'date'] },
    ],
  },
  {
    prompt: 'Worst thing.',
    options: [
      { label: 'Empty', tags: ['buzzy', 'loud'] },
      { label: 'Too packed', tags: ['chill', 'lounge'] },
    ],
  },
  {
    prompt: 'Music.',
    options: [
      { label: 'Indie / rock', tags: ['indie', 'rough'] },
      { label: 'Hip-hop', tags: ['hiphop', 'buzzy'] },
      { label: 'House / EDM', tags: ['house', 'dance'] },
      { label: 'Jazz / lounge', tags: ['jazz', 'lounge'] },
    ],
  },
  {
    prompt: 'Crowd you want.',
    options: [
      { label: 'Old-school regulars', tags: ['locals', 'old-nyc', 'dive'] },
      { label: 'Trendy 20-somethings', tags: ['trendy', 'instagrammable'] },
      { label: 'Industry / creative', tags: ['industry', 'cocktail'] },
    ],
  },
  {
    prompt: 'Drink budget per round.',
    options: [
      { label: '$10–14', tags: ['cheap', 'dive'] },
      { label: '$15–19', tags: ['mid'] },
      { label: '$20+', tags: ['pricey', 'cocktail'] },
    ],
  },
  {
    prompt: 'Dealbreaker.',
    options: [
      { label: 'Tourists', tags: ['locals'] },
      { label: 'Smug crowd', tags: ['dive', 'pub'] },
      { label: 'Too loud', tags: ['chill', 'lounge'] },
      { label: 'Too sleepy', tags: ['buzzy', 'loud'] },
    ],
  },
];

export function deriveArchetype(tags: VibeTag[]): string {
  const has = (tag: VibeTag) => tags.includes(tag);

  if (has('dive') && has('locals')) return 'East Village dive devotee';
  if (has('cocktail') && has('polished')) return 'Cocktail connoisseur';
  if (has('speakeasy') && has('romantic')) return 'Hidden-door romantic';
  if (has('dance') && has('house')) return 'Late-night dancefloor';
  if (has('jazz') && has('lounge')) return 'Jazz lounge sophisticate';
  if (has('rough') && has('cheap')) return 'No-frills regular';
  if (has('trendy') && has('instagrammable')) return 'Williamsburg new-wave';
  if (has('industry') && has('cocktail')) return 'Industry-crowd insider';
  return 'NYC vibe explorer';
}
