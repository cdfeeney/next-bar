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
  highlightIds?: string[];
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

export default function BarMap({ bars, userCoords, highlightIds, fitToBars, oneFingerPan }: BarMapProps) {
  const center: Coords = useMemo(() => {
    if (userCoords) return userCoords;
    return computeCentroid(bars);
  }, [userCoords, bars]);

  const highlightSet = useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
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
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={13}
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
              const miles = userCoords
                ? haversineMiles(userCoords, { lat: bar.lat, lng: bar.lng })
                : null;
              const travelLabel = miles !== null ? leadCopy(miles, bar.neighborhood).text : null;
              return (
                <Marker
                  key={bar.id}
                  position={[bar.lat, bar.lng]}
                  icon={isHighlighted ? highlightIcon : barIcon}
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
