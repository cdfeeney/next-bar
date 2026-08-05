import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  classifyAddress,
  nextRedirectTarget,
  parseIpv4,
  parseIpv6,
} from './netGuard';

describe('parseIpv4', () => {
  it('accepts a dotted quad', () => {
    expect(parseIpv4('1.2.3.4')).toBe(0x01020304);
  });

  it('rejects octal-looking, short, and out-of-range forms', () => {
    // 010.0.0.1 would be octal in some resolvers — never guess, reject.
    expect(parseIpv4('010.0.0.1')).toBeNull();
    expect(parseIpv4('1.2.3')).toBeNull();
    expect(parseIpv4('1.2.3.256')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
  });
});

describe('parseIpv6', () => {
  it('expands :: and plain forms to eight groups', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('2001:db8:0:0:0:0:0:1')?.length).toBe(8);
  });

  it('handles a trailing IPv4 literal and a zone id', () => {
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    expect(parseIpv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('rejects malformed input', () => {
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('12345::1')).toBeNull();
    expect(parseIpv6('not-an-address')).toBeNull();
  });
});

describe('classifyAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.1.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this-network'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
  ])('blocks %s as %s', (addr, why) => {
    const verdict = classifyAddress(addr);
    expect(verdict.blocked).toBe(true);
    // The reason is surfaced in the crawl report, so assert it is the SPECIFIC
    // range rather than a generic string.
    expect(verdict.blocked && verdict.reason).toContain(why);
  });

  it('blocks the cloud metadata endpoints by exact match', () => {
    // AWS/GCP/DO — also inside link-local, but named explicitly.
    expect(classifyAddress('169.254.169.254')).toEqual({
      blocked: true,
      reason: 'cloud metadata endpoint',
    });
    // Azure's wire server sits in PUBLIC unicast space: a range check alone
    // would happily connect to it.
    expect(classifyAddress('168.63.129.16')).toEqual({
      blocked: true,
      reason: 'cloud metadata endpoint',
    });
  });

  it('blocks IPv6 loopback, link-local, unique-local and multicast', () => {
    expect(classifyAddress('::1').blocked).toBe(true);
    expect(classifyAddress('::').blocked).toBe(true);
    expect(classifyAddress('fe80::1').blocked).toBe(true);
    expect(classifyAddress('fc00::1').blocked).toBe(true);
    expect(classifyAddress('fd12:3456::1').blocked).toBe(true);
    expect(classifyAddress('ff02::1').blocked).toBe(true);
  });

  it('unwraps IPv4-mapped and NAT64 addresses instead of trusting the wrapper', () => {
    expect(classifyAddress('::ffff:127.0.0.1').blocked).toBe(true);
    expect(classifyAddress('::ffff:169.254.169.254').blocked).toBe(true);
    expect(classifyAddress('64:ff9b::169.254.169.254').blocked).toBe(true);
    // A mapped PUBLIC address is still fine.
    expect(classifyAddress('::ffff:93.184.216.34').blocked).toBe(false);
  });

  it('allows ordinary public addresses', () => {
    expect(classifyAddress('93.184.216.34').blocked).toBe(false);
    expect(classifyAddress('8.8.8.8').blocked).toBe(false);
    expect(classifyAddress('2606:2800:220:1:248:1893:25c8:1946').blocked).toBe(false);
  });

  it('FAILS CLOSED on anything it cannot parse', () => {
    expect(classifyAddress('').blocked).toBe(true);
    expect(classifyAddress('localhost').blocked).toBe(true);
    expect(classifyAddress('999.999.999.999').blocked).toBe(true);
  });
});

describe('checkUrl', () => {
  it('accepts ordinary http(s) URLs', () => {
    expect(checkUrl('https://example.com/hours').ok).toBe(true);
    expect(checkUrl('http://example.com').ok).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'gopher://example.com',
    'data:text/html,<b>x</b>',
    'jar:http://example.com!/',
    'ftp://example.com',
  ])('rejects the %s scheme', (raw) => {
    expect(checkUrl(raw).ok).toBe(false);
  });

  it('rejects credentials embedded in the URL', () => {
    const v = checkUrl('https://user:pass@example.com');
    expect(v).toEqual({ ok: false, reason: 'credentials in URL' });
  });

  it('rejects literal-address hosts in blocked ranges, including bracketed IPv6', () => {
    expect(checkUrl('http://127.0.0.1/').ok).toBe(false);
    expect(checkUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(checkUrl('http://[::1]/').ok).toBe(false);
    expect(checkUrl('http://192.168.0.5:8080/').ok).toBe(false);
  });

  it('does not reject a hostname merely for looking unusual — DNS decides', () => {
    // Resolution is enforced at connect time in safeFetch; this layer only
    // rules on structure and literal addresses.
    expect(checkUrl('https://metadata.google.internal/').ok).toBe(true);
  });
});

describe('nextRedirectTarget', () => {
  const from = new URL('https://venue.example.com/hours');

  it('THE case this guard exists for: a public host redirecting to cloud metadata', () => {
    const v = nextRedirectTarget(from, 'http://169.254.169.254/latest/meta-data/');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('cloud metadata endpoint');
  });

  it('blocks a redirect to loopback or a private LAN address', () => {
    expect(nextRedirectTarget(from, 'http://127.0.0.1:8080/').ok).toBe(false);
    expect(nextRedirectTarget(from, 'http://192.168.1.1/').ok).toBe(false);
    expect(nextRedirectTarget(from, 'http://[::1]/').ok).toBe(false);
  });

  it('blocks a scheme change into file: or data:', () => {
    expect(nextRedirectTarget(from, 'file:///etc/passwd').ok).toBe(false);
    expect(nextRedirectTarget(from, 'data:text/html,x').ok).toBe(false);
  });

  it('resolves RELATIVE locations against the current URL and still guards them', () => {
    const rel = nextRedirectTarget(from, '/opening-times');
    expect(rel.ok).toBe(true);
    expect(rel.ok && rel.url.toString()).toBe('https://venue.example.com/opening-times');

    // A protocol-relative redirect to a blocked literal must not slip through.
    expect(nextRedirectTarget(from, '//127.0.0.1/x').ok).toBe(false);
  });

  it('allows an ordinary cross-host redirect', () => {
    const v = nextRedirectTarget(from, 'https://www.venue.example.com/hours');
    expect(v.ok).toBe(true);
  });

  it('rejects an unresolvable Location', () => {
    expect(nextRedirectTarget(from, 'http://[bad').ok).toBe(false);
  });
});
