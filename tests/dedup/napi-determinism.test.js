import { describe, it, expect } from 'vitest';
import {
  isDedupAvailable,
  computeFingerprints,
  clusterFingerprints,
} from '../../core/infrastructure/index.js';

describe('dedup NAPI determinism', () => {
  it('addon is available on the dev machine', () => {
    expect(isDedupAvailable()).toBe(true);
  });

  it('fingerprints are bit-identical across 10 repeat runs on the same inputs', () => {
    const fixtures = [
      'function alpha(x) { return x * 2; }',
      'class Beta { constructor(v) { this.v = v; } }',
      'for (let i = 0; i < 10; i++) console.log(i);',
      'pub fn gamma(s: &str) -> usize { s.len() }',
      '// identical header\n// identical header\n// identical header\n// identical header\n// identical header',
    ];

    const first = computeFingerprints(fixtures);
    for (let r = 0; r < 10; r++) {
      const again = computeFingerprints(fixtures);
      for (let i = 0; i < fixtures.length; i++) {
        expect(again[i].simhashHex).toBe(first[i].simhashHex);
        expect(Buffer.compare(again[i].minhash, first[i].minhash)).toBe(0);
      }
    }
  });

  it('each minhash buffer is exactly num_perm × 4 bytes', () => {
    const fps = computeFingerprints(['a b c d e f g h']);
    expect(fps).toHaveLength(1);
    expect(fps[0].minhash.length).toBe(128 * 4);
    expect(fps[0].simhashHex).toHaveLength(16);
    expect(fps[0].simhashHex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('identical texts produce identical fingerprints across batch positions', () => {
    const text = 'const greet = name => `Hello, ${name}!`;\nexport default greet;';
    const fps = computeFingerprints([text, text, text, text]);
    for (let i = 1; i < 4; i++) {
      expect(fps[i].simhashHex).toBe(fps[0].simhashHex);
      expect(Buffer.compare(fps[i].minhash, fps[0].minhash)).toBe(0);
    }
  });

  it('empty input yields an empty output array', () => {
    expect(computeFingerprints([])).toEqual([]);
    expect(clusterFingerprints([])).toEqual([]);
  });
});
