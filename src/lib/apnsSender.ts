import { createSign } from 'node:crypto';
import { connect } from 'node:http2';

/**
 * V8-4 — the APNs provider side. SERVER ONLY.
 *
 * Nothing in this module may ever be imported from a client component. Every
 * credential is read from a non-`NEXT_PUBLIC_` environment variable, which is
 * what makes it structurally impossible for Next.js to inline it into the
 * browser bundle (same rule as SUPABASE_SERVICE_ROLE_KEY in
 * src/app/api/account/delete/route.ts). scripts/check-client-apns-bundle.mjs
 * proves that mechanically against the built output.
 *
 * STAGING ONLY. `readApnsConfig` REFUSES an APNS_ENVIRONMENT of `production`:
 * the V8 goal forbids enabling a production sender, and a config typo is
 * exactly how that would happen by accident rather than by decision.
 *
 * HTTP/2 on purpose: APNs speaks HTTP/2 only, and `fetch` in Node is HTTP/1.1.
 * `node:http2` is the standard library's answer, so there is no new dependency
 * here. The transport is injectable so the response-handling rules below are
 * tested against mocked APNs responses without a socket.
 */

/** The four PRD event types. There is no fifth, and no other name for these. */
export const NOTIFICATION_EVENT_TYPES = [
  'invited',
  'accepted',
  'bar_suggested',
  'plan_changed',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type ApnsConfig = {
  readonly keyId: string;
  readonly teamId: string;
  readonly bundleId: string;
  readonly privateKey: string;
  /** Deliberately narrow — `production` is not a value this codebase accepts. */
  readonly environment: 'sandbox';
};

/**
 * Missing configuration is NOT an error: the APNs key is an attended
 * credential this work is not allowed to create, so an unconfigured deployment
 * must degrade to "nothing is sent" rather than crash a request handler.
 * A *present but production* configuration IS an error and throws — that is a
 * deliberate act that contradicts the staging-only scope.
 */
export function readApnsConfig(
  // Deliberately the widest shape this actually reads, not NodeJS.ProcessEnv:
  // the latter requires NODE_ENV, which forces every caller passing a fixture
  // to cast. The function only ever looks up optional string keys.
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApnsConfig | null {
  const environment = env.APNS_ENVIRONMENT?.trim();
  if (environment && environment !== 'sandbox') {
    throw new Error(
      `APNS_ENVIRONMENT must be "sandbox" for V8 staging work; refusing "${environment}". ` +
        'Enabling the production APNs environment is an attended decision.',
    );
  }

  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const bundleId = env.APNS_BUNDLE_ID?.trim();
  // Env vars cannot hold real newlines in most hosts, so the PEM is stored with
  // literal \n and restored here.
  const privateKey = env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (!keyId || !teamId || !bundleId || !privateKey) return null;

  return { keyId, teamId, bundleId, privateKey, environment: 'sandbox' };
}

export function apnsHost(config: ApnsConfig): string {
  // One environment, one host. The production host is not reachable from here
  // by construction rather than by a branch someone could flip.
  return config.environment === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The APNs provider JWT: ES256 over {alg,kid}.{iss,iat}.
 *
 * `dsaEncoding: 'ieee-p1363'` is load-bearing. Node's default for EC keys is
 * DER, and JWS requires the raw r||s pair — a DER signature is accepted by no
 * verifier and APNs would answer InvalidProviderToken with no hint as to why.
 */
export function buildProviderToken(
  config: ApnsConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64Url(
    JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' }),
  );
  const payload = base64Url(
    JSON.stringify({ iss: config.teamId, iat: nowSeconds }),
  );
  const signature = createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign({ key: config.privateKey, dsaEncoding: 'ieee-p1363' });

  return `${header}.${payload}.${base64Url(signature)}`;
}

export type ApnsOutcome = 'sent' | 'invalid-token' | 'retry' | 'failed';

/**
 * Which APNs answers mean "this device is gone" (criterion 4 — the sender
 * disables or removes invalid tokens) versus "try again" versus "we are
 * misconfigured and retrying will not help".
 *
 * Unregistered/BadDeviceToken are the two that must retire a token. Getting
 * this wrong in the retryable direction means hammering Apple forever with a
 * token that will never work; getting it wrong the other way silently
 * unsubscribes a working device.
 */
export function classifyApnsResponse(
  status: number,
  reason: string | null,
): ApnsOutcome {
  if (status === 200) return 'sent';

  switch (reason) {
    case 'BadDeviceToken':
    case 'Unregistered':
    case 'DeviceTokenNotForTopic':
      return 'invalid-token';
    case 'ExpiredProviderToken':
    case 'TooManyProviderTokenUpdates':
    case 'TooManyRequests':
    case 'ServiceUnavailable':
    case 'InternalServerError':
      return 'retry';
    default:
      break;
  }

  if (status === 410) return 'invalid-token';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}

export type ApnsPayload = {
  readonly title: string;
  readonly body: string;
  readonly nightOutToken: string;
  readonly eventType: NotificationEventType;
};

export type ApnsRequest = {
  readonly deviceToken: string;
  readonly payload: ApnsPayload;
  readonly collapseId?: string;
};

export type ApnsResponse = {
  readonly status: number;
  readonly reason: string | null;
};

/** Injectable so the classification rules above are testable without a socket. */
export type ApnsTransport = (args: {
  readonly host: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}) => Promise<ApnsResponse>;

export function buildApnsBody(payload: ApnsPayload): string {
  return JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'thread-id': payload.nightOutToken,
    },
    // The custom keys the tap handler reads. src/lib/pushDeepLink.ts validates
    // both before they reach a route, so a malformed payload cannot navigate.
    nightOutToken: payload.nightOutToken,
    eventType: payload.eventType,
  });
}

export async function sendApnsNotification(
  config: ApnsConfig,
  request: ApnsRequest,
  transport: ApnsTransport = http2Transport,
  providerToken: string = buildProviderToken(config),
): Promise<{ outcome: ApnsOutcome; status: number; reason: string | null }> {
  const headers: Record<string, string> = {
    ':method': 'POST',
    ':path': `/3/device/${request.deviceToken}`,
    authorization: `bearer ${providerToken}`,
    'apns-topic': config.bundleId,
    'apns-push-type': 'alert',
    'apns-priority': '10',
  };
  if (request.collapseId) headers['apns-collapse-id'] = request.collapseId;

  try {
    const response = await transport({
      host: apnsHost(config),
      path: `/3/device/${request.deviceToken}`,
      headers,
      body: buildApnsBody(request.payload),
    });
    return {
      outcome: classifyApnsResponse(response.status, response.reason),
      status: response.status,
      reason: response.reason,
    };
  } catch (thrown) {
    // A transport failure (DNS, TLS, socket reset) is retryable and must never
    // escape into the caller's drain loop, which would abandon every remaining
    // notification in the batch. The device token is deliberately absent from
    // this message.
    return {
      outcome: 'retry',
      status: 0,
      reason: thrown instanceof Error ? thrown.name : 'TransportError',
    };
  }
}

/** The real transport. APNs is HTTP/2-only; `node:http2` is the stdlib client. */
export const http2Transport: ApnsTransport = ({ host, headers, body }) =>
  new Promise((resolve, reject) => {
    const session = connect(host);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      session.close();
      fn();
    };

    session.on('error', (error) => finish(() => reject(error)));

    const stream = session.request({ ...headers, 'content-type': 'application/json' });
    const chunks: Buffer[] = [];
    let status = 0;

    stream.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status'] ?? 0);
    });
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', (error) => finish(() => reject(error)));
    stream.on('end', () =>
      finish(() => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let reason: string | null = null;
        if (raw) {
          try {
            reason = (JSON.parse(raw) as { reason?: string }).reason ?? null;
          } catch {
            reason = null;
          }
        }
        resolve({ status, reason });
      }),
    );

    stream.setTimeout(10_000, () =>
      finish(() => reject(new Error('ApnsTimeout'))),
    );
    stream.end(body);
  });
