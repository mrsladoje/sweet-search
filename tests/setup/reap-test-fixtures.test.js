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

  it("reaps this checkout's orphaned fixtures and never another checkout's", () => {
    const own = join(OWN_FIXTURES, 'fake-daemon.mjs');
    const markers = [own];
    const listing = [
      `  101     1 /usr/local/bin/node ${own} --port 0`,
      `  102     1 /usr/local/bin/node ${own}`,
      // Same repository, different checkout (main checkout or another worktree).
      '  103     1 /usr/local/bin/node /elsewhere/sweet-search-private/tests/fixtures/fake-daemon.mjs --port 0',
      // The relative fragment the old marker matched.
      '  104     1 node tests/fixtures/fake-daemon.mjs',
      // A longer path that merely starts with the marker.
      `  105     1 node ${own}.bak`,
      `  106     1 /usr/local/bin/node ${own}`,
    ].join('\n');
    expect(reapablePids(listing, markers, 106)).toEqual([101, 102]);
  });

  it("reaps this run's fixtures and leaves a concurrent run's live fixtures alone", () => {
    const own = join(OWN_FIXTURES, 'fake-daemon.mjs');
    const listing = [
      '  500     1 node vitest (this run)',
      '  510   500 node vitest worker',
      `  511   510 /usr/local/bin/node ${own}`,
      // Spawned by a daemon the worker started: still a descendant of this run.
      '  512   510 node search-server',
      `  513   512 /usr/local/bin/node ${own}`,
      '  600     1 node vitest (another run in the same checkout)',
      '  610   600 node vitest worker',
      `  611   610 /usr/local/bin/node ${own}`,
      // Its run is over: nothing owns it any more.
      `  700     1 /usr/local/bin/node ${own}`,
    ].join('\n');
    expect(reapablePids(listing, [own], 500).sort()).toEqual([511, 513, 700]);
  });
});
