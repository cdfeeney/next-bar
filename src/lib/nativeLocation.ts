import { Capacitor } from '@capacitor/core';
import {
  Geolocation,
  type Position as CapacitorPosition,
  type PositionOptions as CapacitorPositionOptions,
} from '@capacitor/geolocation';

export type NativeLocationPermission =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unknown';

export class NativeLocationPermissionDeniedError extends Error {
  constructor() {
    super('Native location permission was denied.');
    this.name = 'NativeLocationPermissionDeniedError';
  }
}

export function isNativeLocationRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

function normalizePermission(
  value: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied',
): NativeLocationPermission {
  if (value === 'prompt-with-rationale') return 'prompt';
  return value;
}

export async function readNativeLocationPermission(): Promise<NativeLocationPermission> {
  if (!isNativeLocationRuntime()) return 'unknown';
  try {
    const status = await Geolocation.checkPermissions();
    return normalizePermission(status.location);
  } catch {
    // Disabled system services and plugin/runtime failures are not permission
    // denials. The caller should show the existing unavailable guidance.
    return 'unknown';
  }
}

export async function requestNativeLocation(
  options: CapacitorPositionOptions,
  requestPermission: boolean,
): Promise<CapacitorPosition> {
  if (!isNativeLocationRuntime()) {
    throw new Error('Native location requested outside a Capacitor runtime.');
  }

  let permission = await readNativeLocationPermission();
  if (requestPermission && permission !== 'granted') {
    try {
      const status = await Geolocation.requestPermissions({
        permissions: ['location'],
      });
      permission = normalizePermission(status.location);
    } catch {
      permission = await readNativeLocationPermission();
    }
  }

  if (permission === 'denied') {
    throw new NativeLocationPermissionDeniedError();
  }
  if (!requestPermission && permission !== 'granted') {
    throw new Error('Native location permission is not already granted.');
  }

  return Geolocation.getCurrentPosition(options);
}
