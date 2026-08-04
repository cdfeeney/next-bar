import type { CapacitorConfig } from '@capacitor/cli';

export type NativeBuildProfile = 'release' | 'internal-remote';
export type NativeBuildEnvironment = Record<string, string | undefined>;

export const RELEASE_WEB_DIR = 'native/app';
export const INTERNAL_WEB_DIR = 'native/shell';

function parseProfile(env: NativeBuildEnvironment): NativeBuildProfile {
  const raw = env.CAPACITOR_BUILD_PROFILE?.trim() || 'release';
  if (raw !== 'release' && raw !== 'internal-remote') {
    throw new Error(
      `Unsupported CAPACITOR_BUILD_PROFILE: ${raw}. Expected release or internal-remote.`,
    );
  }
  return raw;
}

function internalRemoteOrigin(env: NativeBuildEnvironment): URL {
  if (env.CAPACITOR_INTERNAL_ONLY_CONFIRM !== 'INTERNAL ONLY') {
    throw new Error(
      'The internal-remote profile requires CAPACITOR_INTERNAL_ONLY_CONFIRM=INTERNAL ONLY.',
    );
  }
  const raw = env.CAPACITOR_REMOTE_ORIGIN?.trim();
  if (!raw) {
    throw new Error(
      'CAPACITOR_REMOTE_ORIGIN is required for the internal-remote profile.',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('CAPACITOR_REMOTE_ORIGIN must be an absolute HTTPS URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(
      'CAPACITOR_REMOTE_ORIGIN must be a credential-free HTTPS origin with no path, query, or fragment.',
    );
  }

  // The apex is the public brand site; the other two hosts belong to separate
  // applications. A typo here would silently ship the wrong product.
  const forbiddenHosts = new Set([
    'next-bar.com',
    'www.next-bar.com',
    'app.next-bar.com',
    'partners.next-bar.com',
    'investors.next-bar.com',
  ]);
  if (forbiddenHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      `CAPACITOR_REMOTE_ORIGIN cannot target ${url.hostname}; use a reviewed consumer Staging origin.`,
    );
  }

  return url;
}

export function buildNativeConfig(
  env: NativeBuildEnvironment = process.env,
): CapacitorConfig {
  const profile = parseProfile(env);
  const remoteOrigin =
    profile === 'internal-remote' ? internalRemoteOrigin(env) : null;

  if (profile === 'release' && env.CAPACITOR_REMOTE_ORIGIN?.trim()) {
    throw new Error(
      'CAPACITOR_REMOTE_ORIGIN is forbidden for release builds; release must package local UI.',
    );
  }

  return {
    appId: 'com.nextbar.app',
    appName: 'Next Bar',
    // native/app is the future locally packaged product output. It is
    // intentionally absent until the PKCE/API-origin migration is complete;
    // preflight fails a release build while it is absent. native/shell is only
    // the honest offline fallback for the internal remote-origin pipeline probe.
    webDir: profile === 'release' ? RELEASE_WEB_DIR : INTERNAL_WEB_DIR,
    ...(remoteOrigin
      ? {
          server: {
            url: remoteOrigin.origin,
            allowNavigation: [remoteOrigin.hostname],
          },
        }
      : {}),
    ios: {
      backgroundColor: '#0a0a0a',
      contentInset: 'automatic',
    },
  };
}
