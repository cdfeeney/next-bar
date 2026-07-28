/**
 * Address and URL classification for outbound crawling.
 *
 * The venue-website crawl fetches URLs that come from OpenStreetMap `website`
 * tags. Anyone on the internet can edit those, so every URL is hostile input,
 * and the crawler runs on a machine whose environment holds DATABASE_URL and
 * service keys. A URL that resolves to loopback, a private LAN range, or a
 * cloud metadata endpoint is an SSRF against ourselves.
 *
 * This module is PURE — parsing and range classification only, so it can be
 * exhaustively unit-tested. The DNS resolution and connect-time enforcement
 * that use it live in `safeFetch.ts`, because the check that actually matters
 * has to happen against the address the socket connects to, not against a
 * name resolved earlier (otherwise DNS rebinding walks straight through).
 */

/** Only these schemes may ever be fetched. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Individually blocked addresses that sit inside otherwise-public space, so a
 * range check alone would let them through.
 *   169.254.169.254 — AWS/GCP/DO instance metadata (also inside link-local).
 *   168.63.129.16   — Azure wire server. PUBLIC unicast space; range checks miss it.
 */
const BLOCKED_EXACT_V4 = new Set(['169.254.169.254', '168.63.129.16']);

type V4Range = { base: number; bits: number; why: string };

const BLOCKED_V4_RANGES: V4Range[] = [
  { base: ip4ToInt('0.0.0.0'), bits: 8, why: 'this-network' },
  { base: ip4ToInt('10.0.0.0'), bits: 8, why: 'private' },
  { base: ip4ToInt('100.64.0.0'), bits: 10, why: 'carrier-grade NAT' },
  { base: ip4ToInt('127.0.0.0'), bits: 8, why: 'loopback' },
  { base: ip4ToInt('169.254.0.0'), bits: 16, why: 'link-local / cloud metadata' },
  { base: ip4ToInt('172.16.0.0'), bits: 12, why: 'private' },
  { base: ip4ToInt('192.0.0.0'), bits: 24, why: 'IETF protocol assignments' },
  { base: ip4ToInt('192.0.2.0'), bits: 24, why: 'documentation' },
  { base: ip4ToInt('192.168.0.0'), bits: 16, why: 'private' },
  { base: ip4ToInt('198.18.0.0'), bits: 15, why: 'benchmarking' },
  { base: ip4ToInt('198.51.100.0'), bits: 24, why: 'documentation' },
  { base: ip4ToInt('203.0.113.0'), bits: 24, why: 'documentation' },
  { base: ip4ToInt('224.0.0.0'), bits: 4, why: 'multicast' },
  { base: ip4ToInt('240.0.0.0'), bits: 4, why: 'reserved' },
];

function ip4ToInt(ip: string): number {
  const parts = ip.split('.');
  return (
    ((Number(parts[0]) << 24) >>> 0) +
    (Number(parts[1]) << 16) +
    (Number(parts[2]) << 8) +
    Number(parts[3])
  );
}

/** Strict dotted-quad parse. Rejects `1.2.3`, `01.2.3.4`, `1.2.3.256`. */
export function parseIpv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith('0')) return null;
    if (Number(p) > 255) return null;
  }
  return ip4ToInt(value);
}

/** Expand an IPv6 literal to its eight 16-bit groups. Null if unparseable. */
export function parseIpv6(value: string): number[] | null {
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  // Drop a zone id (fe80::1%eth0) — it never makes an address safer.
  const pct = v.indexOf('%');
  if (pct !== -1) v = v.slice(0, pct);
  if (!v.includes(':')) return null;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two groups.
  let tail: number[] = [];
  const lastColon = v.lastIndexOf(':');
  const maybeV4 = v.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const asV4 = parseIpv4(maybeV4);
    if (asV4 === null) return null;
    tail = [(asV4 >>> 16) & 0xffff, asV4 & 0xffff];
    v = v.slice(0, lastColon + 1) + '0';
  }

  const halves = v.split('::');
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  if (head === null) return null;

  if (halves.length === 1) {
    const groups = tail.length ? [...head.slice(0, -1), ...tail] : head;
    return groups.length === 8 ? groups : null;
  }

  const rest = toGroups(halves[1]);
  if (rest === null) return null;
  const explicit = tail.length ? [...rest.slice(0, -1), ...tail] : rest;
  const fill = 8 - head.length - explicit.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...explicit];
}

export type AddressVerdict = { blocked: false } | { blocked: true; reason: string };

/**
 * Is this literal address one we refuse to connect to?
 *
 * Unknown/unparseable input is BLOCKED, not allowed — failing closed is the
 * only safe default for a guard.
 */
export function classifyAddress(address: string): AddressVerdict {
  const v4 = parseIpv4(address);
  if (v4 !== null) return classifyV4(address, v4);

  const v6 = parseIpv6(address);
  if (v6 === null) return { blocked: true, reason: 'unparseable address' };

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) carry a v4 address
  // inside a v6 literal. Unwrap or ::ffff:169.254.169.254 sails past.
  const isV4Mapped =
    v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
  const isNat64 =
    v6[0] === 0x0064 && v6[1] === 0xff9b && v6.slice(2, 6).every((g) => g === 0);
  if (isV4Mapped || isNat64) {
    const embedded = `${(v6[6] >> 8) & 0xff}.${v6[6] & 0xff}.${(v6[7] >> 8) & 0xff}.${v6[7] & 0xff}`;
    const inner = classifyV4(embedded, ip4ToInt(embedded));
    return inner.blocked
      ? { blocked: true, reason: `${inner.reason} (embedded in IPv6)` }
      : { blocked: false };
  }

  if (v6.every((g) => g === 0)) return { blocked: true, reason: 'unspecified ::' };
  if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) {
    return { blocked: true, reason: 'loopback ::1' };
  }
  if ((v6[0] & 0xffc0) === 0xfe80) return { blocked: true, reason: 'IPv6 link-local' };
  if ((v6[0] & 0xfe00) === 0xfc00) return { blocked: true, reason: 'IPv6 unique-local' };
  if ((v6[0] & 0xff00) === 0xff00) return { blocked: true, reason: 'IPv6 multicast' };
  if (v6[0] === 0x2001 && v6[1] === 0x0db8) {
    return { blocked: true, reason: 'IPv6 documentation range' };
  }
  return { blocked: false };
}

function classifyV4(display: string, value: number): AddressVerdict {
  if (BLOCKED_EXACT_V4.has(display)) {
    return { blocked: true, reason: 'cloud metadata endpoint' };
  }
  for (const range of BLOCKED_V4_RANGES) {
    const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
    if ((value & mask) >>> 0 === (range.base & mask) >>> 0) {
      return { blocked: true, reason: range.why };
    }
  }
  return { blocked: false };
}

export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Structural check of a candidate URL, before any DNS or socket work.
 *
 * Rejects non-HTTP schemes (file:, gopher:, data:, jar: …), credentials in the
 * URL, and any host that is a literal address in a blocked range. A hostname
 * still has to clear DNS resolution at connect time — see safeFetch.
 */
export function checkUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `disallowed scheme ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials in URL' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'empty host' };

  // Only classify when the host IS a literal address. A DNS name that merely
  // looks odd is fine here; safeFetch validates what it resolves to.
  const isLiteral = parseIpv4(host) !== null || host.includes(':');
  if (isLiteral) {
    const verdict = classifyAddress(host);
    if (verdict.blocked) return { ok: false, reason: verdict.reason };
  }
  return { ok: true, url };
}

/**
 * Resolve a redirect `Location` against the URL it came from, and re-apply the
 * full guard to the result.
 *
 * This is the control that carries the most weight in the whole crawler. If
 * redirects are followed by the HTTP stack instead, only the FIRST url is ever
 * checked, and a plain `302 Location: http://169.254.169.254/` from any venue
 * website reaches cloud metadata. Lives here, beside the guard, so it is
 * covered by the unit gate rather than stranded in a script.
 */
export function nextRedirectTarget(current: URL, location: string): UrlVerdict {
  let resolved: string;
  try {
    resolved = new URL(location, current).toString();
  } catch {
    return { ok: false, reason: 'unresolvable Location header' };
  }
  return checkUrl(resolved);
}
