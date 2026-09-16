'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Bar } from '@/types';

/**
 * S-08b — a small, NON-INTERACTIVE map of a saved night's stops, zoomed to
 * their area. Deliberately NOT BarMap: that component wraps itself in full-page
 * layout and its `fill`-mode control offset (globals.css `.map-fill`, 6.75rem)
 * is built for a full-height map and mispositions the controls inside a 192px
 * block — a shared-CSS refactor S-08 excluded. This reuses only BarMap's TILE
 * SOURCE (the openfreemap dark basemap, already CSP-allowed) with no chrome, no
 * controls, and every interaction disabled, so there is nothing to mis-size and
 * the map cannot steal a scroll.
 *
 * Load it dynamically with ssr:false (leaflet touches `window` on import).
 */

const NYC_FALLBACK: [number, number] = [40.725, -73.985];

/** Loud accent glow for the Loved stop; a quiet accent dot for the rest. */
const lovedIcon = L.divIcon({
  className: '',
  html: '<div data-stop="loved" style="width:18px;height:18px;background:#ff5b3a;border:3px solid #fff;border-radius:9999px;box-shadow:0 0 16px rgba(255,91,58,0.9);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const stopIcon = L.divIcon({
  className: '',
  html: '<div data-stop="stop" style="width:12px;height:12px;background:#ff5b3a;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 10px rgba(255,91,58,0.7);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

/** The openfreemap dark basemap, added the same way BarMap's DarkBasemap does. */
function DarkBasemap(): JSX.Element | null {
  const map = useMap();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const layer = maplibreGL({ style: 'https://tiles.openfreemap.org/styles/dark' });
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
    <p role="status" className="absolute inset-x-2 top-2 z-[500] rounded bg-black/90 p-1.5 text-center text-[11px] text-white">
      Map couldn&apos;t load.
    </p>
  ) : null;
}

/** Fits the view to the night's stops so it opens zoomed to their area. */
function FitStops({ bars }: { bars: Bar[] }): null {
  const map = useMap();
  useEffect(() => {
    if (bars.length === 0) return;
    if (bars.length === 1) {
      map.setView([bars[0].lat, bars[0].lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(bars.map((b) => [b.lat, b.lng] as [number, number])), {
      padding: [24, 24],
    });
  }, [map, bars]);
  return null;
}

export default function SavedNightMap({
  bars,
  highlightIds = [],
}: {
  bars: Bar[];
  /** Stop ids to render with the loud glow (the Loved stop). */
  highlightIds?: string[];
}): JSX.Element {
  const highlight = useMemo(() => new Set(highlightIds), [highlightIds]);
  return (
    <MapContainer
      center={NYC_FALLBACK}
      zoom={13}
      preferCanvas
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      dragging={false}
      keyboard={false}
      style={{ height: '100%', width: '100%' }}
    >
      <DarkBasemap />
      <FitStops bars={bars} />
      {bars.map((bar, i) => (
        <Marker
          key={`${bar.id}-${i}`}
          position={[bar.lat, bar.lng]}
          icon={highlight.has(bar.id) ? lovedIcon : stopIcon}
          interactive={false}
          // leaflet sets tabIndex=0 + role="button" whenever `keyboard` is truthy
          // (default true), gated on `keyboard` alone, NOT on `interactive`. Without
          // this the inert pins become tab stops announced as buttons that do nothing.
          keyboard={false}
        />
      ))}
    </MapContainer>
  );
}
