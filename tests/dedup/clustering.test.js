import { describe, it, expect } from 'vitest';
import {
  isDedupAvailable,
  computeFingerprints,
  clusterFingerprints,
} from '../../core/infrastructure/index.js';

// Skip when the native Rust addon isn't built (see napi-determinism.test.js
// for the full rationale: hosted `ci.yml` doesn't build the addon; the
// release workflow does and runs the tests there).
const describeIfAddon = isDedupAvailable() ? describe : describe.skip;

describeIfAddon('MinHash-LSH clustering', () => {
  it('identical chunks cluster together', () => {
    const chunk = 'fn process(x: &[u8]) -> Vec<u8> { x.iter().map(|b| b ^ 0x55).collect() }';
    const fps = computeFingerprints([chunk, chunk, chunk]);
    const clusters = clusterFingerprints(fps);
    // One cluster with 3 members.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].siblingIdxs).toHaveLength(2);
    expect(clusters[0].clusterId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('unrelated chunks stay as singletons', () => {
    const chunks = [
      'function alpha(x) { return x + 1; }',
      'class Beta extends Widget { render() { return <div />; } }',
      'impl Gamma for Delta { fn eta(&self) -> u32 { 42 } }',
    ];
    const fps = computeFingerprints(chunks);
    const clusters = clusterFingerprints(fps);
    expect(clusters).toHaveLength(3);
    for (const c of clusters) {
      expect(c.siblingIdxs).toHaveLength(0);
    }
  });

  it('near-duplicate chunks (identical bodies, different indentation/whitespace) cluster', () => {
    const a = 'function foo(x) { let y = x + 1; return y * 2; }';
    const b = 'function foo( x ) { let y = x + 1; return y * 2; }';
    const fps = computeFingerprints([a, b, a, b]);
    const clusters = clusterFingerprints(fps);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // At least one cluster should capture the near-dups.
    const clustered = clusters.some((c) => c.siblingIdxs.length >= 1);
    expect(clustered).toBe(true);
  });

  it('chunk under the ngram size floor does not crash', () => {
    const fps = computeFingerprints(['tiny']);
    const clusters = clusterFingerprints(fps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].siblingIdxs).toHaveLength(0);
  });

  it('cluster IDs are deterministic across runs for the same member set', () => {
    const chunk = 'let result = items.filter(x => x.valid).map(x => x.value);';
    const fps1 = computeFingerprints([chunk, chunk]);
    const c1 = clusterFingerprints(fps1)[0];
    const fps2 = computeFingerprints([chunk, chunk]);
    const c2 = clusterFingerprints(fps2)[0];
    expect(c1.clusterId).toBe(c2.clusterId);
  });
});
