export const CONSUMER_ORIGINS = {
  staging: 'https://staging.next-bar.com',
  production: 'https://app.next-bar.com',
} as const;

export type ConsumerEnvironment = keyof typeof CONSUMER_ORIGINS;
type PublicConsumerEnv = {
  NEXT_PUBLIC_CONSUMER_ENV?: string;
  NEXT_PUBLIC_API_ORIGIN?: string;
};

function runtimeEnv(): PublicConsumerEnv {
  // Direct property reads are required so Next can inline these values into a
  // locally packaged client build. Do not replace with process.env[key].
  return {
    NEXT_PUBLIC_CONSUMER_ENV: process.env.NEXT_PUBLIC_CONSUMER_ENV,
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  };
}

export function resolveConfiguredConsumerOrigin(
  env: PublicConsumerEnv = runtimeEnv(),
): string | null {
  const environment = env.NEXT_PUBLIC_CONSUMER_ENV?.trim();
  const rawOrigin = env.NEXT_PUBLIC_API_ORIGIN?.trim();

  if (!environment && !rawOrigin) return null;
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error(
      'NEXT_PUBLIC_CONSUMER_ENV must be staging or production when a native API origin is configured.',
    );
  }
  if (!rawOrigin) {
    throw new Error('NEXT_PUBLIC_API_ORIGIN is required for a native build.');
  }

  let origin: string;
  try {
    const url = new URL(rawOrigin);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error('not an origin');
    }
    origin = url.origin;
  } catch {
    throw new Error(
      'NEXT_PUBLIC_API_ORIGIN must be a credential-free HTTPS origin.',
    );
  }

  const expected = CONSUMER_ORIGINS[environment];
  if (origin !== expected) {
    throw new Error(
      `NEXT_PUBLIC_API_ORIGIN does not match the ${environment} consumer origin.`,
    );
  }
  return origin;
}

function requireAppPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Consumer request paths must be app-relative.');
  }
}

function currentBrowserOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location.origin;
}

function isHostedWebOrigin(origin: string): boolean {
  try {
    const protocol = new URL(origin).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Web/PWA calls remain relative so Vercel/Supabase cookies and protection work
 * normally. Locally packaged Capacitor calls become absolute and fail closed
 * unless the build embeds the exact reviewed consumer origin.
 */
export function resolveConsumerRequestUrl(
  path: string,
  env: PublicConsumerEnv = runtimeEnv(),
  browserOrigin: string | null = currentBrowserOrigin(),
): string {
  requireAppPath(path);
  if (browserOrigin && isHostedWebOrigin(browserOrigin)) return path;

  const configured = resolveConfiguredConsumerOrigin(env);
  if (!configured) {
    throw new Error('Native consumer API origin is not configured.');
  }
  return `${configured}${path}`;
}

/** Build an absolute user-facing share URL from either web or native UI. */
export function resolveConsumerShareUrl(
  path: string,
  env: PublicConsumerEnv = runtimeEnv(),
  browserOrigin: string | null = currentBrowserOrigin(),
): string {
  requireAppPath(path);
  if (browserOrigin && isHostedWebOrigin(browserOrigin)) {
    return `${new URL(browserOrigin).origin}${path}`;
  }

  const configured = resolveConfiguredConsumerOrigin(env);
  if (!configured) {
    throw new Error('Native consumer share origin is not configured.');
  }
  return `${configured}${path}`;
}
