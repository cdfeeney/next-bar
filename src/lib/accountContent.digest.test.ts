import { describe, expect, test } from 'vitest';
import {
  canonicalAccountContentJson,
  contentIdentity,
  fnv1a64,
} from '@/lib/accountContent.digest';

describe('fnv1a64 — reference vectors', () => {
  // Standard FNV-1a 64-bit test vectors (Fowler/Noll/Vo).
  test('empty string hashes to the offset basis', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
  });

  test('known single-char and word vectors', () => {
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  test('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // '€' is 3 UTF-8 bytes; a code-unit implementation would collide with
    // single-unit inputs and produce a different digest.
    expect(fnv1a64('€')).not.toBe(fnv1a64('€'.charCodeAt(0).toString()));
    // Deterministic: same input, same digest, 16 lowercase hex chars.
    expect(fnv1a64('€')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('€')).toBe(fnv1a64('€'));
  });
});

describe('canonicalAccountContentJson', () => {
  test('object key order never changes the canonical text', () => {
    expect(canonicalAccountContentJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalAccountContentJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  test('arrays keep their order (order is data)', () => {
    expect(canonicalAccountContentJson([1, 2])).not.toBe(
      canonicalAccountContentJson([2, 1]),
    );
  });

  test('null is canonical null', () => {
    expect(canonicalAccountContentJson(null)).toBe('null');
  });
});

describe('contentIdentity', () => {
  test('returns digest plus UTF-8 byte length of the canonical text', () => {
    const id = contentIdentity({ name: '€uro' });
    const canonical = canonicalAccountContentJson({ name: '€uro' });
    expect(id.digest).toBe(fnv1a64(canonical));
    expect(id.byteLength).toBe(new TextEncoder().encode(canonical).length);
    // '€' is 3 bytes — byteLength must exceed the string length.
    expect(id.byteLength).toBeGreaterThan(canonical.length);
  });

  test('is key-order independent for objects', () => {
    expect(contentIdentity({ x: 1, y: 2 })).toEqual(
      contentIdentity({ y: 2, x: 1 }),
    );
  });
});
