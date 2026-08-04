import { describe, expect, it } from 'vitest';
import {
  buildNativeConfig,
  INTERNAL_WEB_DIR,
  RELEASE_WEB_DIR,
} from './native-build-profile';

describe('native build profile', () => {
  it('defaults to a release config with local assets and no server.url', () => {
    const config = buildNativeConfig({});

    expect(config.webDir).toBe(RELEASE_WEB_DIR);
    expect(config.server).toBeUndefined();
    expect(config.appId).toBe('com.nextbar.app');
  });

  it('rejects a remote origin in the release profile', () => {
    expect(() =>
      buildNativeConfig({
        CAPACITOR_BUILD_PROFILE: 'release',
        CAPACITOR_REMOTE_ORIGIN: 'https://staging.next-bar.com',
      }),
    ).toThrow(/forbidden for release/i);
  });

  it('requires an explicit origin for the temporary internal profile', () => {
    expect(() =>
      buildNativeConfig({
        CAPACITOR_BUILD_PROFILE: 'internal-remote',
        CAPACITOR_INTERNAL_ONLY_CONFIRM: 'INTERNAL ONLY',
      }),
    ).toThrow(/CAPACITOR_REMOTE_ORIGIN is required/i);
  });

  it('requires the exact internal-only confirmation', () => {
    expect(() =>
      buildNativeConfig({
        CAPACITOR_BUILD_PROFILE: 'internal-remote',
        CAPACITOR_REMOTE_ORIGIN: 'https://staging.next-bar.com',
      }),
    ).toThrow(/INTERNAL ONLY/);
  });

  it('builds the internal-only profile against consumer Staging', () => {
    const config = buildNativeConfig({
      CAPACITOR_BUILD_PROFILE: 'internal-remote',
      CAPACITOR_INTERNAL_ONLY_CONFIRM: 'INTERNAL ONLY',
      CAPACITOR_REMOTE_ORIGIN: 'https://staging.next-bar.com',
    });

    expect(config.webDir).toBe(INTERNAL_WEB_DIR);
    expect(config.server).toEqual({
      url: 'https://staging.next-bar.com',
      allowNavigation: ['staging.next-bar.com'],
    });
  });

  it.each([
    'http://staging.next-bar.com',
    'https://user:password@staging.next-bar.com',
    'https://staging.next-bar.com/path',
    'https://staging.next-bar.com?x-vercel-protection-bypass=secret',
    'https://staging.next-bar.com/#fragment',
  ])('rejects a credential-bearing or non-origin internal URL: %s', (origin) => {
    expect(() =>
      buildNativeConfig({
        CAPACITOR_BUILD_PROFILE: 'internal-remote',
        CAPACITOR_INTERNAL_ONLY_CONFIRM: 'INTERNAL ONLY',
        CAPACITOR_REMOTE_ORIGIN: origin,
      }),
    ).toThrow(/credential-free HTTPS origin/i);
  });

  it.each([
    'https://next-bar.com',
    'https://www.next-bar.com',
    'https://app.next-bar.com',
    'https://partners.next-bar.com',
    'https://investors.next-bar.com',
  ])('rejects a non-Staging application origin: %s', (origin) => {
    expect(() =>
      buildNativeConfig({
        CAPACITOR_BUILD_PROFILE: 'internal-remote',
        CAPACITOR_INTERNAL_ONLY_CONFIRM: 'INTERNAL ONLY',
        CAPACITOR_REMOTE_ORIGIN: origin,
      }),
    ).toThrow(/reviewed consumer Staging origin/i);
  });

  it('permits an operator-reviewed generated Vercel origin for internal pipeline testing', () => {
    const config = buildNativeConfig({
      CAPACITOR_BUILD_PROFILE: 'internal-remote',
      CAPACITOR_INTERNAL_ONLY_CONFIRM: 'INTERNAL ONLY',
      CAPACITOR_REMOTE_ORIGIN: 'https://next-bar-tw.vercel.app',
    });

    expect(config.server?.url).toBe('https://next-bar-tw.vercel.app');
  });

  it('rejects unknown build profiles', () => {
    expect(() =>
      buildNativeConfig({ CAPACITOR_BUILD_PROFILE: 'production-ish' }),
    ).toThrow(/Unsupported CAPACITOR_BUILD_PROFILE/i);
  });
});
