'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'leaflet-gesture-handling/dist/leaflet-gesture-handling.css';
import { GestureHandling } from 'leaflet-gesture-handling';
import { displayHood } from '@/lib/hoodDisplay';
import type { Bar, Coords } from '@/types';

type BarMapProps = {
  bars: Bar[];
  userCoords?: Coords | null;
  /** MED-15: fly to the user's coords when they land (the /map surface). */
  panToUser?: boolean;
  /** UX-C map search: fly to this bar and open its popup. */
  focusBarId?: string | null;
  /** Bumped per selection so re-picking the SAME bar re-flies (review MED). */
  focusNonce?: number;
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
  /**
   * Edge-to-edge mode for the /map surface, where the locked design makes the
   * map the page itself: no card border, no aspect ratio, height inherited from
   * the parent. Embedded maps (WhereNextFlow results) leave this off and keep
   * their framed card.
   */
  fill?: boolean;
};

const NYC_FALLBACK_CENTER: Coords = { lat: 40.7250, lng: -73.9850 };

function DarkBasemap() {
  const map = useMap();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const layer = maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/dark',
      attributionControl: {
        customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    });
    try {
      layer.addTo(map);
      layer.getMaplibreMap().on('error', () => setFailed(true));
    } catch {
      setFailed(true);
    }
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [map]);
  return failed ? (
    <p role="status" className="absolute top-40 left-2 right-2 z-[500] rounded bg-black/90 p-2 text-center text-xs text-white">
      Street map could not load. Check your connection and reload.
    </p>
  ) : null;
}

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

/**
 * MED-15: when the user's location lands (or changes), PAN there — the
 * MapContainer center prop only applies on mount, so "Use my location"
 * used to plot a marker somewhere off-viewport and go nowhere. Never
 * zooms OUT (keeps a user-chosen zoom), floors at 14 for a usable
 * street-level view.
 */
function PanToUser({ coords }: { coords: Coords | null | undefined }) {
  const map = useMap();
  // String-keyed dep (DeepSeek review): a geolocation hook that re-emits a
  // fresh coords OBJECT each fix must not re-fly the map unless the actual
  // position moved — identity churn here would fight the user's panning.
  const coordsKey = coords
    ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`
    : null;
  useEffect(() => {
    if (!coordsKey || !coords) return;
    map.flyTo([coords.lat, coords.lng], Math.max(map.getZoom(), 14), {
      duration: 0.8,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordsKey stands in for coords
  }, [map, coordsKey]);
  return null;
}

/**
 * UX-C: flies to a searched bar and opens a popup on it. Id-keyed so a
 * re-render with the same focus never re-flies against the user's pan.
 */
function FocusBar({ bar, nonce }: { bar: Bar | null; nonce?: number }) {
  const map = useMap();
  const barId = bar?.id ?? null;
  useEffect(() => {
    if (!bar) return;
    map.flyTo([bar.lat, bar.lng], Math.max(map.getZoom(), 16), {
      duration: 0.6,
    });
    // textContent-built popup — never string-interpolated HTML.
    const el = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = bar.name;
    const sub = document.createElement('div');
    sub.textContent = `${displayHood(bar.neighborhood)} · ${'$'.repeat(bar.priceTier)}`;
    el.append(name, sub);
    map.openPopup(L.popup().setLatLng([bar.lat, bar.lng]).setContent(el));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- barId+nonce stand in for bar
  }, [map, barId, nonce]);
  return null;
}

export default function BarMap({ bars, userCoords, panToUser, focusBarId, focusNonce, highlightIds, suggestedIds, fitToBars, oneFingerPan, fill }: BarMapProps) {
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
    <section className={fill ? 'h-full w-full' : 'px-4 py-8 md:px-6 md:py-12'}>
      <div className={fill ? 'h-full w-full' : 'max-w-5xl mx-auto'}>
        <div
          className={
            fill
              ? 'map-fill h-full w-full overflow-hidden'
              : 'rounded-2xl border border-border overflow-hidden'
          }
          style={{
            // `fill` maps ARE the page (the /map surface): edge to edge, no card
            // chrome, height from the parent instead of an aspect ratio.
            ...(fill ? { height: '100%' } : { aspectRatio: '4 / 5' }),
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
            minZoom={1}
            maxZoom={20}
            maxBounds={[[-85, -Infinity], [85, Infinity]]}
            maxBoundsViscosity={1}
            preferCanvas
            scrollWheelZoom={false}
            doubleClickZoom={false}
            tap={true}
            // `fill` maps (the /map surface) draw their OWN search/Filters/Locate
            // column over the top-left corner, which is where Leaflet puts the
            // zoom stack. At leaflet's stock 30px the two only grazed; once
            // 76c6f80 grew the buttons to the 44px a11y minimum the zoom-out
            // button landed squarely on the Filters button's centre and ate its
            // click (map-interaction.spec.ts, both viewports). Move the stack to
            // the free right edge instead of shrinking a control back below the
            // accessible minimum. Embedded maps have no such column and keep the
            // stock corner.
            zoomControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <ZoomControl position={fill ? 'bottomright' : 'topleft'} />
            {oneFingerPan ? null : <GestureController />}
            {fitToBars ? <FitBounds bars={bars} /> : null}
            {panToUser ? <PanToUser coords={userCoords} /> : null}
            <FocusBar
              bar={focusBarId ? (bars.find((b) => b.id === focusBarId) ?? null) : null}
              nonce={focusNonce}
            />
            <DarkBasemap />
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
              return (
                <Marker
                  key={bar.id}
                  position={[bar.lat, bar.lng]}
                  icon={icon}
                  zIndexOffset={isTiered ? TIER_Z_OFFSET[tier] : 0}
                >
                  <Popup>
                    <div className="font-bold">{bar.name}</div>
                    <div className="text-xs">{displayHood(bar.neighborhood)}</div>
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
