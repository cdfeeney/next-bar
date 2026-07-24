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

/**
 * Browser permission posture, independent of any single fix attempt.
 * 'denied' is the load-bearing value: iOS Safari (and the OS-level
 * Location Services toggle) can put a site in a state where the prompt
 * NEVER shows — surfaces must explain that instead of failing silently.
 * 'unknown' = no Permissions API (older Safari) and nothing learned yet.
 */
export type GeoPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

export type UseGeolocationReturn = {
  state: GeoState;
  request: () => void;
  reset: () => void;
  coords: Coords | null;
  accuracyBand: AccuracyBand;
  snappedNeighborhood: ManhattanNeighborhood | null;
  permissionState: GeoPermissionState;
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
  const [permissionState, setPermissionState] =
    useState<GeoPermissionState>('unknown');
  const stateRef = useRef<GeoState>(state);
  stateRef.current = state;

  // Track browser permission posture: Permissions API where available
  // (live via onchange), and learned from request outcomes everywhere
  // (a code-1 failure means denied even without the API).
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (typeof navigator.permissions?.query !== 'function') return;
    let cancelled = false;
    let statusRef: PermissionStatus | null = null;
    const sync = (): void => {
      if (!cancelled && statusRef) {
        setPermissionState(statusRef.state as GeoPermissionState);
      }
    };
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        statusRef = status;
        sync();
        status.addEventListener('change', sync);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      statusRef?.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!hasGeolocation()) {
      setState((current) =>
        current.status === 'idle' ? { status: 'unavailable' } : current,
      );
    }
  }, []);

  // AUTO-RESUME (U2-4): once the user has granted location to this site,
  // later visits should not demand another "Use my location" tap — the
  // browser fires no prompt for an already-granted permission, so a silent
  // fetch on mount is free UX. Strictly feature-detected: no Permissions
  // API (or a query that throws, e.g. older Safari) → exactly the old
  // tap-to-request behavior. 'prompt'/'denied' states never auto-request —
  // surprising permission dialogs on load are hostile.
  useEffect(() => {
    if (!hasGeolocation()) return;
    if (typeof navigator.permissions?.query !== 'function') return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled || status.state !== 'granted') return;
        // Same guard shape as request(): read the ref, set plainly, fetch
        // OUTSIDE any updater (DeepSeek review: updaters must stay pure —
        // React double-invokes them under StrictMode).
        if (stateRef.current.status !== 'idle') return;
        setState({ status: 'requesting' });
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (cancelled) return;
            setState(classifySuccess(position));
            setPermissionState('granted');
          },
          (error) => {
            // A SILENT attempt must not paint failure UI the user never
            // asked for (DeepSeek review): OS-off / timeout returns to
            // idle so the manual button still works untainted. A genuine
            // permission revocation (code 1) is a real signal — keep it.
            if (cancelled) return;
            setState(
              error.code === 1 ? classifyError(error) : { status: 'idle' },
            );
            if (error.code === 1) setPermissionState('denied');
          },
          GEO_OPTIONS,
        );
      })
      .catch(() => {
        // Permissions API present but geolocation unqueryable — keep the
        // manual flow.
      });
    return () => {
      cancelled = true;
      // StrictMode runs mount→cleanup→mount: the first pass may have
      // parked state at 'requesting' before its callbacks were discarded —
      // give the slot back so the second pass (or a manual tap) can run
      // (a permanent 'requesting' deadlock was caught by the map e2e).
      setState((current) =>
        current.status === 'requesting' ? { status: 'idle' } : current,
      );
    };
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
        setPermissionState('granted');
      },
      (error) => {
        setState(classifyError(error));
        if (error.code === 1) setPermissionState('denied');
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
    permissionState,
  };
}
