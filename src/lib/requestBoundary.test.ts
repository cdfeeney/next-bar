import { describe, expect, it } from 'vitest';
import {
  classifyOrigin,
  contentLengthExceeds,
  guardOrigin,
  readBoundedBody,
  readBoundedJson,
  requestPublicHost,
} from '@/lib/requestBoundary';

/** A stream that fails partway through, as a dropped connection does. */
function failingStream(bytesBeforeError = 8): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode('x'.repeat(bytesBeforeError)));
        return;
      }
      controller.error(new Error('connection reset'));
    },
  });
}

function streamOf(totalBytes: number, chunkBytes = 16): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode('x'.repeat(chunkBytes));
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
}

describe('contentLengthExceeds', () => {
  it('rejects an honestly oversized header', () => {
    expect(contentLengthExceeds('100', 64)).toBe(true);
  });

  it('accepts a header exactly at the cap — the bound is inclusive', () => {
    expect(contentLengthExceeds('64', 64)).toBe(false);
  });

  it('defers to the bounded read when the header is absent or garbage', () => {
    // Returning false here is not "allow": it means the header proved
    // nothing, so enforcement falls to the read that cannot be lied to.
    expect(contentLengthExceeds(null, 64)).toBe(false);
    expect(contentLengthExceeds('not-a-number', 64)).toBe(false);
  });
});

describe('readBoundedBody', () => {
  it('reads a body that fits', async () => {
    const read = await readBoundedBody(streamOf(32), 64);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.bytes.byteLength).toBe(32);
  });

  it('cancels a body that crosses the cap mid-stream', async () => {
    const read = await readBoundedBody(streamOf(4096), 64);
    expect(read.kind).toBe('too-large');
  });

  it('counts UTF-8 BYTES, not string length', async () => {
    // '€' is one JS character but three UTF-8 bytes. A length-based cap
    // would let 3x the intended payload through.
    const euros = new TextEncoder().encode('€'.repeat(10)); // 30 bytes
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(euros);
        controller.close();
      },
    });
    expect((await readBoundedBody(body, 20)).kind).toBe('too-large');
  });

  it('treats a null body as an empty read', async () => {
    const read = await readBoundedBody(null, 64);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.bytes.byteLength).toBe(0);
  });

  it('reports a FAILING stream instead of rejecting', async () => {
    // A dropped connection must become an outcome the route can answer with
    // a 400 — not an escaped rejection that Next turns into a 500.
    await expect(readBoundedBody(failingStream(), 64)).resolves.toEqual({
      kind: 'stream-error',
    });
  });

  it('still returns too-large when the stream errors AFTER the cap is crossed', async () => {
    // The 413 decision is already made; a cancel() that rejects on the
    // errored stream must not overwrite it with a server error.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(128)));
        controller.error(new Error('reset right after the oversize chunk'));
      },
    });
    await expect(readBoundedBody(body, 64)).resolves.toEqual({
      kind: 'too-large',
    });
  });
});

describe('guardOrigin', () => {
  const deny = () => new Response('no', { status: 403 });
  const headers = (init: Record<string, string>) => new Headers(init);

  it('allows a same-origin request', () => {
    expect(
      guardOrigin(
        headers({ origin: 'https://next-bar.com', host: 'next-bar.com' }),
        deny,
      ),
    ).toBeNull();
  });

  it('always blocks cross-origin, even when absent is allowed', () => {
    const blocked = guardOrigin(
      headers({ origin: 'https://evil.example', host: 'next-bar.com' }),
      deny,
      { allowAbsent: 'sendBeacon' },
    );
    expect(blocked?.status).toBe(403);
  });

  it('blocks an absent origin BY DEFAULT — strict unless opted out', () => {
    const blocked = guardOrigin(headers({ host: 'next-bar.com' }), deny);
    expect(blocked?.status).toBe(403);
  });

  it('rejects a BLANK justification — a reason must actually be a reason', () => {
    // Plain truthiness would let `' '` (or a stray boolean from JS) buy
    // leniency with nothing documented, defeating the point of the string.
    const blocked = guardOrigin(headers({ host: 'next-bar.com' }), deny, {
      allowAbsent: '   ',
    });
    expect(blocked?.status).toBe(403);
  });

  it('rejects a non-string justification from a JS caller', () => {
    const blocked = guardOrigin(headers({ host: 'next-bar.com' }), deny, {
      allowAbsent: true as unknown as string,
    });
    expect(blocked?.status).toBe(403);
  });

  it('allows an absent origin only when a reason is supplied', () => {
    expect(
      guardOrigin(headers({ host: 'next-bar.com' }), deny, {
        allowAbsent: 'navigator.sendBeacon',
      }),
    ).toBeNull();
  });

  it('passes the verdict to the response builder for logging', () => {
    let seen: string | null = null;
    guardOrigin(headers({ host: 'next-bar.com' }), (verdict) => {
      seen = verdict;
      return deny();
    });
    expect(seen).toBe('absent');
  });
});

describe('requestPublicHost', () => {
  it('prefers x-forwarded-host and takes its FIRST hop', () => {
    expect(requestPublicHost('next-bar.com, internal', 'internal.vercel')).toBe(
      'next-bar.com',
    );
  });

  it('falls back to Host, lower-cased', () => {
    expect(requestPublicHost(null, 'Next-Bar.COM')).toBe('next-bar.com');
  });

  it('returns null when neither is usable', () => {
    expect(requestPublicHost(null, null)).toBeNull();
    expect(requestPublicHost('   ', null)).toBeNull();
  });
});

describe('classifyOrigin', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('matches an origin against the public host', () => {
    expect(
      classifyOrigin(
        headers({ origin: 'https://next-bar.com', host: 'next-bar.com' }),
      ),
    ).toBe('same-origin');
  });

  it('matches against x-forwarded-host ahead of Host', () => {
    expect(
      classifyOrigin(
        headers({
          origin: 'https://next-bar.com',
          'x-forwarded-host': 'next-bar.com',
          host: 'internal-routing.vercel',
        }),
      ),
    ).toBe('same-origin');
  });

  it('reports a mismatched origin as cross-origin', () => {
    expect(
      classifyOrigin(
        headers({ origin: 'https://evil.example', host: 'next-bar.com' }),
      ),
    ).toBe('cross-origin');
  });

  it('reports an absent origin distinctly, so each route can set policy', () => {
    expect(classifyOrigin(headers({ host: 'next-bar.com' }))).toBe('absent');
  });

  it('treats a malformed origin as cross-origin, never as absent', () => {
    expect(
      classifyOrigin(headers({ origin: '://nonsense', host: 'next-bar.com' })),
    ).toBe('cross-origin');
  });

  it('accepts the native shell schemes', () => {
    expect(
      classifyOrigin(
        headers({ origin: 'capacitor://localhost', host: 'next-bar.com' }),
      ),
    ).toBe('same-origin');
  });

  it('refuses to claim same-origin when the host cannot be determined', () => {
    expect(classifyOrigin(headers({ origin: 'https://next-bar.com' }))).toBe(
      'cross-origin',
    );
  });

  it('ignores port-less/case differences the URL parser normalizes', () => {
    expect(
      classifyOrigin(
        headers({ origin: 'https://NEXT-BAR.com', host: 'next-bar.com' }),
      ),
    ).toBe('same-origin');
  });
});

describe('readBoundedJson', () => {
  function request(body: BodyInit | null, init: RequestInit = {}): Request {
    return new Request('http://localhost/x', {
      method: 'POST',
      body,
      ...init,
    });
  }

  it('parses a body within the cap', async () => {
    const out = await readBoundedJson(request(JSON.stringify({ a: 1 })), 1024);
    expect(out).toEqual({ kind: 'ok', value: { a: 1 } });
  });

  it('reports too-large on an honest Content-Length without reading', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-length': '99999' },
      body: JSON.stringify({ a: 1 }),
    });
    expect((await readBoundedJson(req, 64)).kind).toBe('too-large');
  });

  it('reports too-large on an oversized stream with no honest header', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: streamOf(4096),
      // @ts-expect-error - undici-only option, not in the DOM RequestInit type
      duplex: 'half',
    });
    expect((await readBoundedJson(req, 64)).kind).toBe('too-large');
  });

  it('distinguishes invalid JSON from an oversized body', async () => {
    const out = await readBoundedJson(request('{not json'), 1024);
    expect(out.kind).toBe('invalid-json');
  });
});
