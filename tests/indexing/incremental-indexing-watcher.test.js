/**
 * Tests for the WSL2-detect watcher default.
 *
 * Plan § 9.1-9.5, § 34.6.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { watcherDefault, formatWatcherNotice, __testing } from '../../core/incremental-indexing/infrastructure/wsl2-detect.mjs';

describe('watcherDefault', () => {
  it('respects SWEET_SEARCH_WATCH=1 explicit override', () => {
    const d = watcherDefault({ SWEET_SEARCH_WATCH: '1' });
    expect(d.watcherEnabled).toBe(true);
    expect(d.reason).toBe('env-override-on');
  });

  it('respects SWEET_SEARCH_WATCH=0 explicit override', () => {
    const d = watcherDefault({ SWEET_SEARCH_WATCH: '0' });
    expect(d.watcherEnabled).toBe(false);
    expect(d.reason).toBe('env-override-off');
  });

  it('formatWatcherNotice prefixes [sweet-search]', () => {
    const msg = formatWatcherNotice({ watcherEnabled: false, reason: 'wsl2' });
    expect(msg.startsWith('[sweet-search]')).toBe(true);
  });

  it('environment detection result is cached', () => {
    __testing.resetCache();
    const probe = __testing.detectInner();
    expect(typeof probe).toBe('object');
    expect(typeof probe.wsl2).toBe('boolean');
  });
});
