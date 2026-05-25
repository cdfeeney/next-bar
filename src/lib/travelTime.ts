import {
  UBER_MIN_PER_MILE,
  WALK_BOUNDARY_MI,
  WALK_MIN_PER_MILE,
} from '@/lib/constants';

export function walkMinutes(miles: number): number {
  return Math.max(1, Math.round(miles * WALK_MIN_PER_MILE));
}

export function uberMinutes(miles: number): number {
  return Math.max(1, Math.round(miles * UBER_MIN_PER_MILE));
}

export type LeadCopy =
  | { kind: 'walk'; minutes: number; text: string }
  | { kind: 'uber'; minutes: number; text: string }
  | { kind: 'neighborhood'; text: string };

export function leadCopy(miles: number | null, neighborhood?: string): LeadCopy {
  if (miles === null) {
    return {
      kind: 'neighborhood',
      text: neighborhood ? `In ${neighborhood}` : 'Pick a neighborhood',
    };
  }
  if (miles <= WALK_BOUNDARY_MI) {
    const minutes = walkMinutes(miles);
    return { kind: 'walk', minutes, text: `~${minutes} min walk` };
  }
  const minutes = uberMinutes(miles);
  return { kind: 'uber', minutes, text: `~${minutes} min by Uber` };
}
