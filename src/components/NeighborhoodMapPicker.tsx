'use client';

import { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { displayHood } from '@/lib/hoodDisplay';
import type { ManhattanNeighborhood } from '@/types';

type NeighborhoodMapPickerProps = {
  selected: ManhattanNeighborhood[];
  onChange: (next: ManhattanNeighborhood[]) => void;
  options: ManhattanNeighborhood[];
  title: string;
};

const MAP_CENTER: [number, number] = [40.755, -73.98];
const HOBOKEN: [number, number] = [40.7357, -74.0301];

function markerIcon(selected: boolean): L.DivIcon {
  const size = selected ? 22 : 16;
  return L.divIcon({
    className: '',
    html: `<span aria-hidden="true" style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${selected ? '#ff5b3a' : '#f4f1ea'};border:${selected ? 3 : 2}px solid ${selected ? '#fff' : '#ff5b3a'};box-shadow:0 0 ${selected ? 18 : 8}px rgba(255,91,58,${selected ? '0.85' : '0.45'});"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const comingSoonIcon = L.divIcon({
  className: '',
  html: '<span aria-hidden="true" style="display:block;width:14px;height:14px;border-radius:9999px;background:#777;border:2px solid #bbb;"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

/**
 * The final quiz question as a lightweight real map. Dots use the same
 * centroids as matching/location resolution, so the visual and the eventual
 * filter cannot disagree. Hoboken is shown honestly as coming soon: the
 * current catalog rejects it, and making it selectable would guarantee an
 * empty result.
 */
export default function NeighborhoodMapPicker({
  selected,
  onChange,
  options,
  title,
}: NeighborhoodMapPickerProps) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (neighborhood: ManhattanNeighborhood) => {
    onChange(
      selectedSet.has(neighborhood)
        ? selected.filter((item) => item !== neighborhood)
        : [...selected, neighborhood],
    );
  };

  return (
    <section className="max-w-2xl mx-auto px-6">
      <h2 className="font-display text-2xl md:text-3xl text-center mb-3">
        {title}
      </h2>

      <div
        aria-live="polite"
        className="mb-4 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-center"
      >
        {selected.length === 0 ? (
          <span className="text-muted">
            Anywhere works — or tap neighborhoods on the map.
          </span>
        ) : (
          <>
            <span className="text-muted block text-xs uppercase tracking-widest mb-1">
              Your picks
            </span>
            <span>{selected.map(displayHood).join(' · ')}</span>
          </>
        )}
      </div>

      <div
        data-testid="neighborhood-map-picker"
        className="h-[430px] md:h-[520px] overflow-hidden rounded-3xl border border-border bg-surface"
      >
        <MapContainer
          center={MAP_CENTER}
          zoom={11}
          minZoom={10}
          maxZoom={15}
          scrollWheelZoom={false}
          className="h-full w-full"
          aria-label="Map of supported neighborhoods"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {options.map((neighborhood) => {
            const coords = NEIGHBORHOOD_CENTROIDS[neighborhood];
            const isSelected = selectedSet.has(neighborhood);
            const label = displayHood(neighborhood);
            return (
              <Marker
                key={`${neighborhood}-${isSelected ? 'selected' : 'idle'}`}
                position={[coords.lat, coords.lng]}
                icon={markerIcon(isSelected)}
                title={`${isSelected ? 'Remove' : 'Add'} ${label}`}
                alt={`${isSelected ? 'Selected' : 'Select'} ${label}`}
                eventHandlers={{ click: () => toggle(neighborhood) }}
              >
                <Tooltip
                  direction="top"
                  offset={[0, -8]}
                  opacity={1}
                  permanent={isSelected}
                >
                  {label}
                </Tooltip>
              </Marker>
            );
          })}
          <Marker
            position={HOBOKEN}
            icon={comingSoonIcon}
            title="Hoboken — coming soon"
            alt="Hoboken — coming soon"
          >
            <Tooltip direction="left" opacity={1} permanent>
              Hoboken · coming soon
            </Tooltip>
          </Marker>
        </MapContainer>
      </div>

      <p className="text-muted text-xs text-center mt-3">
        Manhattan, Brooklyn and Queens are live. Hoboken is coming soon.
      </p>

      <details className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer min-h-[44px] flex items-center font-display text-sm touch-manipulation">
          Prefer a list?
        </summary>
        <div
          role="group"
          aria-label="Neighborhood list"
          className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-3"
        >
          {options.map((neighborhood) => {
            const isSelected = selectedSet.has(neighborhood);
            return (
              <button
                key={neighborhood}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(neighborhood)}
                className={[
                  'min-h-[44px] rounded-xl px-3 py-2 text-sm touch-manipulation',
                  isSelected
                    ? 'bg-accent text-bg border border-accent'
                    : 'bg-bg text-text border border-border hover:border-accent',
                ].join(' ')}
              >
                {displayHood(neighborhood)}
              </button>
            );
          })}
        </div>
      </details>
    </section>
  );
}
