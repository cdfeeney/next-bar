'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-gesture-handling/dist/leaflet-gesture-handling.css';
import { GestureHandling } from 'leaflet-gesture-handling';
import { haversineMiles } from '@/lib/distance';
import { leadCopy } from '@/lib/travelTime';
import type { Bar, Coords } from '@/types';

type BarMapProps = {
  bars: Bar[];
  userCoords?: Coords | null;
  /**
   * Bars the user has rated (Loved/Liked). Legacy mode (suggestedIds
   * undefined): these get the loud accent glow and every other bar renders
   * as an accent dot. Tiered mode (suggestedIds provided): these render as
   * the mid-tier "rated" accent ring instead.
   */
  highlightIds?: string[];
  /**
   * B6 marker tiers. When provided (even empty), the map switches to the
   * three-tier scheme: `suggested` (loud accent glow, largest, top z-order)
   * · `rated` (small accent ring, from highlightIds) · `other` (quiet 8px
   * grey dot, lowest z-order). When undefined, legacy two-tier rendering is
   * kept so embedded maps (WhereNextFlow results) are untouched.
   */
  suggestedIds?: string[];
  /** When set, the map zooms to fit every bar marker (used by the full catalog view). */
  fitToBars?: boolean;
  /**
   * When set, a single finger pans the map (and two fingers still pinch-zoom).
   * Use only on dedicated full-screen map views where the map owns the whole
   * touch surface. Leave off for maps embedded inside a scrollable page, where
   * gesture-handling (two-finger) keeps single-finger swipes scrolling the page.
   */
  oneFingerPan?: boolean;
};

const NYC_FALLBACK_CENTER: Coords = { lat: 40.7250, lng: -73.9850 };

const barIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;background:#ff5b3a;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 12px rgba(255,91,58,0.8);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const highlightIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;background:#ff5b3a;border:3px solid #fff;border-radius:9999px;box-shadow:0 0 20px rgba(255,91,58,1),0 0 36px rgba(255,91,58,0.6);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// --- B6 marker tiers (used when `suggestedIds` is provided) ---------------
// The `data-tier` attributes are load-bearing: e2e specs count markers per
// tier through them. Keep them if the markup changes.

/** Suggested: current accent glow, slightly larger than the old highlight. */
const suggestedIcon = L.divIcon({
  className: '',
  html: '<div data-tier="suggested" style="width:22px;height:22px;background:#ff5b3a;border:3px solid #fff;border-radius:9999px;box-shadow:0 0 20px rgba(255,91,58,1),0 0 36px rgba(255,91,58,0.6);"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Rated (Loved/Liked): small accent ring — visible but quiet. */
const ratedIcon = L.divIcon({
  className: '',
  html: '<div data-tier="rated" style="width:12px;height:12px;background:transparent;border:2px solid #ff5b3a;border-radius:9999px;box-shadow:0 0 8px rgba(255,91,58,0.5);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

/** Everything else: 8px light-grey dot at ~60% opacity, lowest z-order. */
const otherIcon = L.divIcon({
  className: '',
  html: '<div data-tier="other" style="width:8px;height:8px;background:#9ca3af;opacity:0.6;border-radius:9999px;"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

/** Marker stacking: suggested above rated above the grey long tail. */
const TIER_Z_OFFSET = { suggested: 2000, rated: 1000, other: -1000 } as const;

const userIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#3b82f6;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 18px rgba(59,130,246,0.9);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function computeCentroid(items: Bar[]): Coords {
  if (items.length === 0) return NYC_FALLBACK_CENTER;
  let latSum = 0;
  let lngSum = 0;
  for (const b of items) {
    latSum += b.lat;
    lngSum += b.lng;
  }
  return { lat: latSum / items.length, lng: lngSum / items.length };
}

/**
 * Registers the gesture-handling Leaflet handler on mount. This forces the
 * iOS Safari user to use two fingers to pan/zoom the map so that single-finger
 * vertical swipes scroll the page instead of accidentally panning the map.
 */
function GestureController() {
  const map = useMap();
  useEffect(() => {
    map.addHandler('gestureHandling', GestureHandling);
    // @ts-expect-error: plugin extends L.Map at runtime; type defs don't expose gestureHandling
    map.gestureHandling.enable();
  }, [map]);
  return null;
}

/** Fits the viewport to every bar marker — keeps a two-borough catalog in frame. */
function FitBounds({ bars }: { bars: Bar[] }) {
  const map = useMap();
  useEffect(() => {
    if (bars.length === 0) return;
    const bounds = L.latLngBounds(bars.map((b) => [b.lat, b.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, bars]);
  return null;
}

export default function BarMap({ bars, userCoords, highlightIds, suggestedIds, fitToBars, oneFingerPan }: BarMapProps) {
  const center: Coords = useMemo(() => {
    if (userCoords) return userCoords;
    return computeCentroid(bars);
  }, [userCoords, bars]);

  const highlightSet = useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
  );

  // Tiered mode is on whenever the caller declares a suggested tier — an
  // empty array means "tiers, but nothing is suggested" (e.g. no quiz yet).
  const isTiered = suggestedIds !== undefined;
  const suggestedSet = useMemo(
    () => new Set(suggestedIds ?? []),
    [suggestedIds],
  );

  return (
    <section className="px-4 py-8 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div
          className="rounded-2xl border border-border overflow-hidden"
          style={{
            aspectRatio: '4 / 5',
            // One-finger-pan maps own the touch surface entirely ('none'); embedded
            // maps keep 'pan-y' so a vertical swipe still scrolls the page.
            touchAction: oneFingerPan ? 'none' : 'pan-y',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {/*
            preferCanvas: vector layers render to canvas instead of SVG so the
            map stays cheap as the catalog grows (divIcon markers stay DOM
            nodes regardless — the canvas renderer covers paths/circles).
            SCALING TRIGGER (blueprint B6): at >500 markers, switch the grey
            "other" tier to canvas CircleMarkers and add marker clustering
            (e.g. leaflet.markercluster) — DOM divIcons don't scale past that.
          */}
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={13}
            preferCanvas
            scrollWheelZoom={false}
            doubleClickZoom={false}
            tap={true}
            style={{ height: '100%', width: '100%' }}
          >
            {oneFingerPan ? null : <GestureController />}
            {fitToBars ? <FitBounds bars={bars} /> : null}
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; OpenStreetMap &copy; CARTO"
            />
            {userCoords && (
              <Marker position={[userCoords.lat, userCoords.lng]} icon={userIcon}>
                <Popup>You are here</Popup>
              </Marker>
            )}
            {bars.map((bar) => {
              const isHighlighted = highlightSet.has(bar.id);
              // Tier resolution: suggested wins over rated (a Loved bar can
              // also be suggested), everything else falls to the quiet tier.
              const tier: keyof typeof TIER_Z_OFFSET = suggestedSet.has(bar.id)
                ? 'suggested'
                : isHighlighted
                ? 'rated'
                : 'other';
              const icon = isTiered
                ? tier === 'suggested'
                  ? suggestedIcon
                  : tier === 'rated'
                  ? ratedIcon
                  : otherIcon
                : isHighlighted
                ? highlightIcon
                : barIcon;
              const miles = userCoords
                ? haversineMiles(userCoords, { lat: bar.lat, lng: bar.lng })
                : null;
              const travelLabel = miles !== null ? leadCopy(miles, bar.neighborhood).text : null;
              return (
                <Marker
                  key={bar.id}
                  position={[bar.lat, bar.lng]}
                  icon={icon}
                  zIndexOffset={isTiered ? TIER_Z_OFFSET[tier] : 0}
                >
                  <Popup>
                    <div className="font-bold">{bar.name}</div>
                    <div className="text-xs">
                      {travelLabel
                        ? `${bar.neighborhood} · ${travelLabel}`
                        : bar.neighborhood}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </section>
  );
}
