import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    getCurrentPosition: mocks.getCurrentPosition,
  },
}));

import {
  NativeLocationPermissionDeniedError,
  readNativeLocationPermission,
  requestNativeLocation,
} from './nativeLocation';

describe('nativeLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(true);
  });

  it('does not touch the plugin outside a native runtime', async () => {
    mocks.isNativePlatform.mockReturnValue(false);

    await expect(readNativeLocationPermission()).resolves.toBe('unknown');
    await expect(requestNativeLocation({}, true)).rejects.toThrow(
      /outside a Capacitor runtime/i,
    );
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });

  it('normalizes prompt-with-rationale to the product prompt state', async () => {
    mocks.checkPermissions.mockResolvedValue({
      location: 'prompt-with-rationale',
    });

    await expect(readNativeLocationPermission()).resolves.toBe('prompt');
  });

  it('requests permission only for an explicit user request', async () => {
    const position = {
      timestamp: 1,
      coords: { latitude: 40.7, longitude: -74, accuracy: 10 },
    };
    mocks.checkPermissions.mockResolvedValue({ location: 'prompt' });
    mocks.requestPermissions.mockResolvedValue({ location: 'granted' });
    mocks.getCurrentPosition.mockResolvedValue(position);

    await expect(
      requestNativeLocation({ enableHighAccuracy: true }, true),
    ).resolves.toBe(position);
    expect(mocks.requestPermissions).toHaveBeenCalledWith({
      permissions: ['location'],
    });
  });

  it('does not prompt during silent auto-resume', async () => {
    mocks.checkPermissions.mockResolvedValue({ location: 'prompt' });

    await expect(requestNativeLocation({}, false)).rejects.toThrow(
      /not already granted/i,
    );
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('reports a denied native permission distinctly', async () => {
    mocks.checkPermissions.mockResolvedValue({ location: 'denied' });
    mocks.requestPermissions.mockResolvedValue({ location: 'denied' });

    await expect(requestNativeLocation({}, true)).rejects.toBeInstanceOf(
      NativeLocationPermissionDeniedError,
    );
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
  });
});
