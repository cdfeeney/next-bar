import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  apnsHost,
  buildApnsBody,
  buildProviderToken,
  classifyApnsResponse,
  readApnsConfig,
  sendApnsNotification,
  type ApnsConfig,
  type ApnsTransport,
} from './apnsSender';

/**
 * V8-4 criteria 4, 5, 10 and 12 — the sender's behaviour against MOCKED APNs
 * responses. There is no APNs key on this machine (it is an attended
 * credential) and no network here, so the transport is injected: every rule
 * that decides whether a token gets retired, retried or dropped is exercised
 * without either.
 */

// A real P-256 key, generated per run. Never a committed secret.
const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG: ApnsConfig = {
  keyId: 'ABCD123456',
  teamId: 'TEAM123456',
  bundleId: 'com.nextbar.app',
  privateKey: privateKey as unknown as string,
  environment: 'sandbox',
};

const PAYLOAD = {
  title: "You're invited",
  body: 'Sam invited you to your Night Out.',
  nightOutToken: '11111111-2222-4333-8444-555555555555',
  eventType: 'invited' as const,
};

describe('readApnsConfig', () => {
  it('returns null when the attended APNs credential is absent (criterion 12)', () => {
    // The designed state of this repository today: no key, so nothing sends.
    // A crash here would take the drain endpoint down instead.
    expect(readApnsConfig({})).toBeNull();
  });

  it('returns null when only SOME of the credential parts are present', () => {
    expect(
      readApnsConfig({
        APNS_KEY_ID: 'ABCD123456',
        APNS_TEAM_ID: 'TEAM123456',
      }),
    ).toBeNull();
  });

  it('REFUSES a production APNs environment outright (criterion 12)', () => {
    // The whole goal is staging-only. A config typo must not be the thing that
    // quietly starts pushing from the production APNs environment.
    expect(() =>
      readApnsConfig({
        APNS_ENVIRONMENT: 'production',
        APNS_KEY_ID: 'ABCD123456',
        APNS_TEAM_ID: 'TEAM123456',
        APNS_BUNDLE_ID: 'com.nextbar.app',
        APNS_PRIVATE_KEY: 'x',
      }),
    ).toThrow(/sandbox/i);
  });

  it('restores a PEM stored with literal backslash-n', () => {
    const config = readApnsConfig({
      APNS_ENVIRONMENT: 'sandbox',
      APNS_KEY_ID: 'ABCD123456',
      APNS_TEAM_ID: 'TEAM123456',
      APNS_BUNDLE_ID: 'com.nextbar.app',
      APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----',
    });
    expect(config?.privateKey).toContain('\n');
    expect(config?.privateKey).not.toContain('\\n');
  });

  it('only ever addresses the sandbox host', () => {
    expect(apnsHost(CONFIG)).toBe('https://api.sandbox.push.apple.com');
  });
});

describe('buildProviderToken', () => {
  it('signs an ES256 JWT with the key id in the header and the team as issuer', () => {
    const token = buildProviderToken(CONFIG, 1_700_000_000);
    const [header, payload, signature] = token.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'ABCD123456',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: 'TEAM123456',
      iat: 1_700_000_000,
    });
    // JWS requires the raw r||s pair (64 bytes for P-256), NOT Node's default
    // DER wrapper. A DER signature here would be rejected by APNs as
    // InvalidProviderToken with no explanation of why.
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
  });

  it('is base64url, never base64 — no +, / or = may appear', () => {
    const token = buildProviderToken(CONFIG, 1_700_000_001);
    expect(token).not.toMatch(/[+/=]/);
  });
});

describe('classifyApnsResponse (criterion 4)', () => {
  it('treats 200 as sent', () => {
    expect(classifyApnsResponse(200, null)).toBe('sent');
  });

  it.each([
    [410, 'Unregistered'],
    [400, 'BadDeviceToken'],
    [400, 'DeviceTokenNotForTopic'],
  ])('retires the token on %i %s', (status, reason) => {
    expect(classifyApnsResponse(status, reason)).toBe('invalid-token');
  });

  it('retires the token on a 410 even when Apple sends no reason body', () => {
    expect(classifyApnsResponse(410, null)).toBe('invalid-token');
  });

  it.each([
    [403, 'ExpiredProviderToken'],
    [429, 'TooManyRequests'],
    [503, 'ServiceUnavailable'],
    [500, 'InternalServerError'],
  ])('retries on %i %s', (status, reason) => {
    expect(classifyApnsResponse(status, reason)).toBe('retry');
  });

  it('retries any 5xx, including one with an unrecognised reason', () => {
    expect(classifyApnsResponse(502, 'SomethingNew')).toBe('retry');
  });

  it('gives up on a misconfiguration that retrying cannot fix', () => {
    // InvalidProviderToken means the KEY is wrong. Retrying is a busy loop.
    expect(classifyApnsResponse(403, 'InvalidProviderToken')).toBe('failed');
    expect(classifyApnsResponse(413, 'PayloadTooLarge')).toBe('failed');
    expect(classifyApnsResponse(405, 'MethodNotAllowed')).toBe('failed');
  });
});

describe('buildApnsBody', () => {
  it('carries the deep-link token and event type as custom keys', () => {
    const body = JSON.parse(buildApnsBody(PAYLOAD));
    expect(body.nightOutToken).toBe(PAYLOAD.nightOutToken);
    expect(body.eventType).toBe('invited');
    expect(body.aps.alert).toEqual({ title: PAYLOAD.title, body: PAYLOAD.body });
  });

  it('never embeds a credential in the payload (criterion 5)', () => {
    const body = buildApnsBody(PAYLOAD);
    expect(body).not.toContain(CONFIG.privateKey);
    expect(body).not.toContain(CONFIG.keyId);
    expect(body).not.toContain(CONFIG.teamId);
  });
});

describe('sendApnsNotification', () => {
  const capture = (response: { status: number; reason: string | null }) => {
    const calls: Parameters<ApnsTransport>[0][] = [];
    const transport: ApnsTransport = async (args) => {
      calls.push(args);
      return response;
    };
    return { calls, transport };
  };

  it('addresses /3/device/<token> with the bundle id as the topic', async () => {
    const { calls, transport } = capture({ status: 200, reason: null });
    await sendApnsNotification(
      CONFIG,
      { deviceToken: 'a'.repeat(64), payload: PAYLOAD },
      transport,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(`/3/device/${'a'.repeat(64)}`);
    expect(calls[0].headers['apns-topic']).toBe('com.nextbar.app');
    expect(calls[0].headers.authorization).toMatch(/^bearer /);
    expect(calls[0].host).toBe('https://api.sandbox.push.apple.com');
  });

  it('reports an unregistered device as invalid-token so the drain retires it', async () => {
    const { transport } = capture({ status: 410, reason: 'Unregistered' });
    const result = await sendApnsNotification(
      CONFIG,
      { deviceToken: 'b'.repeat(64), payload: PAYLOAD },
      transport,
    );
    expect(result).toEqual({ outcome: 'invalid-token', status: 410, reason: 'Unregistered' });
  });

  it('converts a thrown transport error into a retry, never a throw', async () => {
    // A DNS or TLS failure mid-batch must not abandon every remaining
    // notification in the drain loop.
    const transport: ApnsTransport = async () => {
      throw new Error('socket hang up');
    };
    const result = await sendApnsNotification(
      CONFIG,
      { deviceToken: 'c'.repeat(64), payload: PAYLOAD },
      transport,
    );
    expect(result.outcome).toBe('retry');
    expect(result.status).toBe(0);
  });

  it('never puts the device token or the private key in the returned reason', async () => {
    const token = 'd'.repeat(64);
    const transport: ApnsTransport = async () => {
      throw new Error(`failed for ${token}`);
    };
    const result = await sendApnsNotification(
      CONFIG,
      { deviceToken: token, payload: PAYLOAD },
      transport,
    );
    // Only the error's NAME is surfaced, never its message.
    expect(result.reason).toBe('Error');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(CONFIG.privateKey);
  });

  it('reuses a caller-supplied provider token instead of minting a new one', async () => {
    const { calls, transport } = capture({ status: 200, reason: null });
    await sendApnsNotification(
      CONFIG,
      { deviceToken: 'e'.repeat(64), payload: PAYLOAD },
      transport,
      'PRE.MINTED.TOKEN',
    );
    expect(calls[0].headers.authorization).toBe('bearer PRE.MINTED.TOKEN');
  });
});
