import { describe, it, expect } from 'vitest';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMarkers, reapablePids } from './reap-test-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWN_FIXTURES = join(HERE, '..', 'fixtures');

describe('reap-test-fixtures', () => {
  it('builds absolute markers for this checkout only', () => {
    const markers = fixtureMarkers();
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(isAbsolute(m)).toBe(true);
      expect(m.startsWith(OWN_FIXTURES + '/')).toBe(true);
    }
  });

  it("reaps this checkout's fixtures and never another checkout's", () => {
    const own = join(OWN_FIXTURES, 'fake-daemon.mjs');
    const markers = [own];
    const listing = [
      ` 101 /usr/local/bin/node ${own} --port 0`,
      ` 102 /usr/local/bin/node ${own}`,
      // Same repository, different checkout (main checkout or another worktree).
      ' 103 /usr/local/bin/node /elsewhere/sweet-search-private/tests/fixtures/fake-daemon.mjs --port 0',
      // The relative fragment the old marker matched.
      ' 104 node tests/fixtures/fake-daemon.mjs',
      // A longer path that merely starts with the marker.
      ` 105 node ${own}.bak`,
      ` 106 /usr/local/bin/node ${own}`,
    ].join('\n');
    expect(reapablePids(listing, markers, 106)).toEqual([101, 102]);
  });
});
