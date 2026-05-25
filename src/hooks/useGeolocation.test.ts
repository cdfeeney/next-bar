import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useGeolocation } from './useGeolocation';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

type SuccessCb = (position: GeolocationPosition) => void;
type ErrorCb = (error: GeolocationPositionError) => void;

type GetCurrentPositionMock = Mock<
  (success: SuccessCb, error?: ErrorCb, options?: PositionOptions) => void
>;

function buildPosition(
  latitude: number,
  longitude: number,
  accuracy: number,
): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() {
        return {};
      },
    } as GeolocationCoordinates,
    timestamp: Date.now(),
    toJSON() {
      return {};
    },
  } as GeolocationPosition;
}

function buildError(code: 1 | 2 | 3): GeolocationPositionError {
  return {
    code,
    message: 'test',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

function installGeolocation(): GetCurrentPositionMock {
  const getCurrentPosition = vi.fn() as GetCurrentPositionMock;
  Object.defineProperty(global.navigator, 'geolocation', {
    value: { getCurrentPosition },
    writable: true,
    configurable: true,
  });
  return getCurrentPosition;
}

function uninstallGeolocation(): void {
  Object.defineProperty(global.navigator, 'geolocation', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

function looksLikeCoord(arg: unknown): boolean {
  if (arg === null || typeof arg !== 'object') return false;
  const obj = arg as Record<string, unknown>;
  if (typeof obj.lat === 'number' && typeof obj.lng === 'number') return true;
  if (typeof obj.latitude === 'number' && typeof obj.longitude === 'number') {
    return true;
  }
  if (obj.coords && typeof obj.coords === 'object') return true;
  return false;
}

describe('useGeolocation', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function assertNoCoordLogs(): void {
    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        expect(looksLikeCoord(arg)).toBe(false);
      }
    }
  }

  it('starts in idle with unknown band and null coords', () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation());

    expect(result.current.state.status).toBe('idle');
    expect(result.current.coords).toBeNull();
    expect(result.current.accuracyBand).toBe('unknown');
    expect(result.current.snappedNeighborhood).toBeNull();
    assertNoCoordLogs();
  });

  it('enters requesting state after request() while navigator pending', () => {
    const getCurrentPosition = installGeolocation();
    // never resolve
    getCurrentPosition.mockImplementation(() => {});

    const { result } = renderHook(() => useGeolocation());

    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('requesting');
    expect(result.current.coords).toBeNull();
    expect(result.current.accuracyBand).toBe('unknown');
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    assertNoCoordLogs();
  });

  it('does not call getCurrentPosition twice if already requesting (no double prompt)', () => {
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation(() => {});

    const { result } = renderHook(() => useGeolocation());

    act(() => {
      result.current.request();
    });
    act(() => {
      result.current.request();
    });

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('granted_precise: accuracy <= 200m yields raw coords and precise band', () => {
    const getCurrentPosition = installGeolocation();
    const raw = { latitude: 40.7550, longitude: -73.9840, accuracy: 50 };
    getCurrentPosition.mockImplementation((success) => {
      success(buildPosition(raw.latitude, raw.longitude, raw.accuracy));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('granted_precise');
    expect(result.current.coords).toEqual({
      lat: raw.latitude,
      lng: raw.longitude,
    });
    expect(result.current.accuracyBand).toBe('precise');
    expect(result.current.snappedNeighborhood).toBeNull();
    assertNoCoordLogs();
  });

  it('granted_snapped: accuracy > 200m near Midtown centroid snaps to Midtown', () => {
    const getCurrentPosition = installGeolocation();
    const midtown = NEIGHBORHOOD_CENTROIDS['Midtown'];
    // a fix very close to Midtown centroid, but coarse accuracy
    getCurrentPosition.mockImplementation((success) => {
      success(buildPosition(midtown.lat + 0.001, midtown.lng + 0.001, 500));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('granted_snapped');
    expect(result.current.accuracyBand).toBe('snapped');
    expect(result.current.snappedNeighborhood).toBe('Midtown');
    expect(result.current.coords).toEqual(midtown);
    assertNoCoordLogs();
  });

  it('granted_coarse: accuracy > 200m and outside Manhattan BBox yields null coords', () => {
    const getCurrentPosition = installGeolocation();
    // Brooklyn — outside Manhattan BBox
    getCurrentPosition.mockImplementation((success) => {
      success(buildPosition(40.65, -73.95, 500));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('granted_coarse');
    expect(result.current.accuracyBand).toBe('coarse');
    expect(result.current.coords).toBeNull();
    expect(result.current.snappedNeighborhood).toBeNull();
    assertNoCoordLogs();
  });

  it('denied: PERMISSION_DENIED (code 1) produces denied status', () => {
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((_success, error) => {
      error?.(buildError(1));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('denied');
    expect(result.current.coords).toBeNull();
    expect(result.current.accuracyBand).toBe('unknown');
    assertNoCoordLogs();
  });

  it('unavailable on POSITION_UNAVAILABLE (code 2) error', () => {
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((_success, error) => {
      error?.(buildError(2));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('unavailable');
    expect(result.current.accuracyBand).toBe('unknown');
    assertNoCoordLogs();
  });

  it('unavailable when navigator.geolocation is missing; request() is a no-op', () => {
    uninstallGeolocation();

    const { result } = renderHook(() => useGeolocation());

    // useEffect runs synchronously inside renderHook in jsdom
    expect(result.current.state.status).toBe('unavailable');

    act(() => {
      result.current.request();
    });

    expect(result.current.state.status).toBe('unavailable');
    expect(result.current.coords).toBeNull();
    expect(result.current.accuracyBand).toBe('unknown');
    assertNoCoordLogs();
  });

  it('reset() returns to idle from a granted state', () => {
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((success) => {
      success(buildPosition(40.7550, -73.9840, 50));
    });

    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.request();
    });
    expect(result.current.state.status).toBe('granted_precise');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.coords).toBeNull();
    expect(result.current.accuracyBand).toBe('unknown');
    expect(result.current.snappedNeighborhood).toBeNull();
    assertNoCoordLogs();
  });
});
