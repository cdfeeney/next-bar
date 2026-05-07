'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { bars } from '@/lib/bars';
import { haversineMiles, formatDistance } from '@/lib/distance';
import { matchScore } from '@/lib/matching';
import type { Coords, VibeProfile } from '@/types';

type BarMapProps = { profile: VibeProfile };

const FALLBACK_CENTER: Coords = { lat: 40.7250, lng: -73.9850 };

const barIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;background:#ff5b3a;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 12px rgba(255,91,58,0.8);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const userIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#3b82f6;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 18px rgba(59,130,246,0.9);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export default function BarMap({ profile }: BarMapProps) {
  const [userPos, setUserPos] = useState<Coords | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserPos(null),
      { timeout: 5000 },
    );
  }, []);

  const center = userPos ?? FALLBACK_CENTER;

  const ranked = useMemo(() => {
    return bars
      .map((b) => ({
        bar: b,
        distance: haversineMiles(center, { lat: b.lat, lng: b.lng }),
        score: matchScore(profile, b),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.distance - b.distance;
      });
  }, [center, profile]);

  return (
    <section className="px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-2xl border border-border overflow-hidden" style={{ height: 420 }}>
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap &copy; CARTO'
            />
            {userPos && (
              <Marker position={[userPos.lat, userPos.lng]} icon={userIcon}>
                <Popup>You are here</Popup>
              </Marker>
            )}
            {ranked.map(({ bar, distance, score }) => (
              <Marker key={bar.id} position={[bar.lat, bar.lng]} icon={barIcon}>
                <Popup>
                  <div className="font-bold">{bar.name}</div>
                  <div className="text-xs">
                    {bar.neighborhood} · {formatDistance(distance)} away
                  </div>
                  <div className="text-xs">{score}% vibe match</div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="mt-10 mb-6">
          <h2 className="font-display text-3xl md:text-4xl">Bars near you, ranked.</h2>
          <p className="text-muted text-sm mt-2">
            {userPos
              ? 'Using your location.'
              : 'Showing NYC center — allow location for distances from you.'}
          </p>
        </div>

        <div className="grid gap-3">
          {ranked.slice(0, 8).map(({ bar, distance, score }, idx) => (
            <div
              key={bar.id}
              className="flex items-start gap-4 bg-surface border border-border rounded-2xl p-5"
            >
              <div className="font-display text-2xl text-accent w-8 shrink-0">{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-lg">{bar.name}</div>
                <div className="text-muted text-xs">{bar.neighborhood}</div>
                <div className="text-muted text-sm mt-1">{bar.blurb}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-accent">{score}% match</div>
                <div className="text-muted text-xs">{formatDistance(distance)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
