'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccuracyBand,
  Coords,
  GeoState,
  ManhattanNeighborhood,
} from '@/types';
import { COARSE_ACCURACY_M } from '@/lib/constants';
import { snapToNeighborhoodCentroid } from '@/lib/geo';

export type UseGeolocationReturn = {
  state: GeoState;
  request: () => void;
  reset: () => void;
  coords: Coords | null;
  accuracyBand: AccuracyBand;
  snappedNeighborhood: ManhattanNeighborhood | null;
};

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 60_000,
};

function classifySuccess(position: GeolocationPosition): GeoState {
  const accuracyMeters = position.coords.accuracy;
  const raw: Coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };

  if (accuracyMeters <= COARSE_ACCURACY_M) {
    return {
      status: 'granted_precise',
      coords: raw,
      accuracyMeters,
    };
  }

  const snap = snapToNeighborhoodCentroid(raw);
  if (snap !== null) {
    return {
      status: 'granted_snapped',
      coords: snap.centroid,
      accuracyMeters,
      snappedTo: snap.neighborhood,
    };
  }

  return {
    status: 'granted_coarse',
    coords: raw,
    accuracyMeters,
  };
}

function classifyError(error: GeolocationPositionError): GeoState {
  if (error.code === 1) {
    return { status: 'denied' };
  }
  return { status: 'unavailable' };
}

function deriveView(state: GeoState): {
  coords: Coords | null;
  accuracyBand: AccuracyBand;
  snappedNeighborhood: ManhattanNeighborhood | null;
} {
  switch (state.status) {
    case 'granted_precise':
      return {
        coords: state.coords,
        accuracyBand: 'precise',
        snappedNeighborhood: null,
      };
    case 'granted_snapped':
      return {
        coords: state.coords,
        accuracyBand: 'snapped',
        snappedNeighborhood: state.snappedTo,
      };
    case 'granted_coarse':
      return {
        coords: null,
        accuracyBand: 'coarse',
        snappedNeighborhood: null,
      };
    case 'idle':
    case 'requesting':
    case 'denied':
    case 'unavailable':
    default:
      return {
        coords: null,
        accuracyBand: 'unknown',
        snappedNeighborhood: null,
      };
  }
}

function hasGeolocation(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.geolocation !== 'undefined' &&
    navigator.geolocation !== null
  );
}

export function useGeolocation(): UseGeolocationReturn {
  const [state, setState] = useState<GeoState>({ status: 'idle' });
  const stateRef = useRef<GeoState>(state);
  stateRef.current = state;

  useEffect(() => {
    if (!hasGeolocation()) {
      setState((current) =>
        current.status === 'idle' ? { status: 'unavailable' } : current,
      );
    }
  }, []);

  const request = useCallback(() => {
    if (stateRef.current.status === 'requesting') return;
    if (!hasGeolocation()) {
      setState({ status: 'unavailable' });
      return;
    }

    setState({ status: 'requesting' });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState(classifySuccess(position));
      },
      (error) => {
        setState(classifyError(error));
      },
      GEO_OPTIONS,
    );
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const derived = useMemo(() => deriveView(state), [state]);

  return {
    state,
    request,
    reset,
    coords: derived.coords,
    accuracyBand: derived.accuracyBand,
    snappedNeighborhood: derived.snappedNeighborhood,
  };
}
