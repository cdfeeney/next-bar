import { describe, expect, it } from 'vitest';
import {
  resolveConfiguredConsumerOrigin,
  resolveConsumerRequestUrl,
  resolveConsumerShareUrl,
} from './consumerOrigin';

describe('consumer origin isolation', () => {
  it('allows an unconfigured ordinary web build to keep relative requests', () => {
    expect(
      resolveConsumerRequestUrl('/api/event', {}, 'https://staging.next-bar.com'),
    ).toBe('/api/event');
  });

  it('uses the exact staging origin from a locally packaged app', () => {
    const env = {
      NEXT_PUBLIC_CONSUMER_ENV: 'staging',
      NEXT_PUBLIC_API_ORIGIN: 'https://staging.next-bar.com',
    };

    expect(resolveConsumerRequestUrl('/api/event', env, 'capacitor://localhost')).toBe(
      'https://staging.next-bar.com/api/event',
    );
    expect(resolveConsumerShareUrl('/share/bar-1', env, 'capacitor://localhost')).toBe(
      'https://staging.next-bar.com/share/bar-1',
    );
  });

  it('uses the consumer app subdomain for a Production native build', () => {
    expect(
      resolveConfiguredConsumerOrigin({
        NEXT_PUBLIC_CONSUMER_ENV: 'production',
        NEXT_PUBLIC_API_ORIGIN: 'https://app.next-bar.com',
      }),
    ).toBe('https://app.next-bar.com');
  });

  it.each([
    'https://next-bar.com',
    'https://partners.next-bar.com',
    'https://investors.next-bar.com',
    'https://staging.next-bar.com?x-vercel-protection-bypass=secret',
  ])('rejects the wrong or credential-bearing Production origin: %s', (origin) => {
    expect(() =>
      resolveConfiguredConsumerOrigin({
        NEXT_PUBLIC_CONSUMER_ENV: 'production',
        NEXT_PUBLIC_API_ORIGIN: origin,
      }),
    ).toThrow();
  });

  it('fails closed when a local native build has no origin', () => {
    expect(() =>
      resolveConsumerRequestUrl('/api/event', {}, 'capacitor://localhost'),
    ).toThrow(/not configured/i);
  });

  it.each(['api/event', '//attacker.example/path'])(
    'rejects a non-app-relative path: %s',
    (path) => {
      expect(() =>
        resolveConsumerRequestUrl(path, {}, 'https://app.next-bar.com'),
      ).toThrow(/app-relative/i);
    },
  );
});
