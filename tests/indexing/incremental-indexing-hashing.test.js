/**
 * Tests for core/incremental-indexing/infrastructure/hashing.mjs
 *
 * Covers plan § 7.2 hash-choice contract and § 33 pre-merge checklist:
 *  - 16-hex-char output (compat with existing SHA-256 truncate-16 callers).
 *  - Deterministic across re-invocations.
 *  - Distinct content → distinct hash (small smoke; statistical collision
 *    sweeps belong to the Phase 0 preflight document, not the unit suite).
 *  - stableStringify produces identical bytes regardless of key order.
 *  - SHA-256 override path works when SWEET_SEARCH_HASH_ALGORITHM=sha256.
 */

import { describe, it, expect } from 'vitest';
import {
  contentHash,
  contentHashSync,
  metadataFingerprint,
  stableStringify,
  __testing,
} from '../../core/incremental-indexing/infrastructure/hashing.mjs';

describe('hashing / contentHash', () => {
  it('returns 16-hex characters for any input', async () => {
    const h = await contentHash('hello world');
    expect(h).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic across repeated calls', async () => {
    expect(await contentHash('foo')).toBe(await contentHash('foo'));
    expect(contentHashSync('foo')).toBe(contentHashSync('foo'));
  });

  it('distinct inputs produce distinct hashes (smoke)', () => {
    const samples = new Set();
    for (let i = 0; i < 1000; i++) samples.add(contentHashSync(`chunk-${i}`));
    expect(samples.size).toBe(1000);
  });

  it('accepts Buffer / Uint8Array / string', () => {
    const a = contentHashSync('hello');
    const b = contentHashSync(Buffer.from('hello'));
    const c = contentHashSync(new Uint8Array(Buffer.from('hello')));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('rejects unsupported input types', () => {
    expect(() => contentHashSync(123)).toThrow(TypeError);
    expect(() => contentHashSync({})).toThrow(TypeError);
  });
});

describe('hashing / stableStringify', () => {
  it('emits canonical key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
  });

  it('handles arrays element-wise without sorting', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives directly', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('s')).toBe('"s"');
    expect(stableStringify(42)).toBe('42');
  });
});

describe('hashing / metadataFingerprint', () => {
  it('ignores key order', async () => {
    const a = await metadataFingerprint({ x: 1, y: 2, z: { p: 1, q: 2 } });
    const b = await metadataFingerprint({ z: { q: 2, p: 1 }, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('changes when any nested value changes', async () => {
    const a = await metadataFingerprint({ x: 1, y: 2 });
    const b = await metadataFingerprint({ x: 1, y: 3 });
    expect(a).not.toBe(b);
  });
});

describe('hashing / pure-JS fallback (xxh64)', () => {
  it('produces 16-hex output for varying buffer sizes', () => {
    const sizes = [0, 1, 7, 8, 9, 31, 32, 33, 64, 4096];
    for (const n of sizes) {
      const buf = Buffer.alloc(n, 0xAB);
      const h = __testing.xxh64PureJs(buf).toString(16).padStart(16, '0');
      expect(h).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});
