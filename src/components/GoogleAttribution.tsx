import type { Bar } from '@/types';

/**
 * Google attribution for Places-derived content.
 *
 * Google permits displaying Places information WITHOUT a Google map as long
 * as the required attribution is shown, and permits displaying photos and
 * reviews with author attribution plus a link to the original Google Maps
 * content. That permission is what lets us keep the Leaflet/OSM map instead
 * of paying for Google map loads — so this component is load-bearing, not
 * decoration. Render it anywhere Places-derived data is visible.
 */

/** Canonical deep link to a place's Google Maps entry. */
export function googleMapsPlaceUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

export default function GoogleAttribution({
  bar,
  className = '',
  label = 'Some venue details powered by Google',
}: {
  bar?: Pick<Bar, 'googlePlaceId' | 'name'>;
  className?: string;
  /** Override for photo-specific surfaces ("Photo via Google"). */
  label?: string;
}): JSX.Element {
  const placeId = bar?.googlePlaceId;
  return (
    <p data-testid="google-attribution" className={`text-[10px] text-muted ${className}`}>
      {label}
      {placeId ? (
        <>
          {' · '}
          <a
            href={googleMapsPlaceUrl(placeId)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            View{bar?.name ? ` ${bar.name}` : ''} on Google Maps
          </a>
        </>
      ) : null}
    </p>
  );
}
