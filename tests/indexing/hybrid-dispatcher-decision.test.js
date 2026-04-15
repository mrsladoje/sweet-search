/**
 * Unit tests for `decideHybridDispatcher` — the pure policy function that
 * controls whether the LI hybrid CPU+GPU dispatcher arms.
 *
 * Context: `SWEET_SEARCH_LI_HYBRID=1` alone is not enough. The Metal
 * command queue is shared with the parallel embed phase by default, so
 * hybrid must be refused unless parallel embed is disabled OR embed is
 * forced onto the CPU ORT path. Without this guard, a user who naively
 * flips the hybrid env var hits pathological underperformance with no
 * warning (tests/diagnose-hybrid-hang.js — the file name is the tell).
 *
 * See `core/indexing/indexer-ann.js::decideHybridDispatcher` for the
 * policy itself. The runtime call site in `buildLateInteractionIndex`
 * reimplements the log-on-contended branch separately; don't forget to
 * update both if the policy changes.
 */

import { describe, it, expect } from 'vitest';
import { decideHybridDispatcher } from '../../core/indexing/indexer-ann.js';

describe('decideHybridDispatcher (runtime hybrid guard policy)', () => {
  it('refuses hybrid when SWEET_SEARCH_LI_HYBRID is unset', () => {
    const decision = decideHybridDispatcher({
      env: {},
      parallelLateInteraction: false,
    });
    expect(decision.armed).toBe(false);
    expect(decision.reason).toBe('not-enabled');
  });

  it.each(['0', 'false', 'off', '', 'yes'])(
    'refuses hybrid when SWEET_SEARCH_LI_HYBRID=%s (not a truthy value)',
    (val) => {
      const decision = decideHybridDispatcher({
        env: { SWEET_SEARCH_LI_HYBRID: val },
        parallelLateInteraction: false,
      });
      expect(decision.armed).toBe(false);
      expect(decision.reason).toBe('not-enabled');
    }
  );

  it.each(['1', 'true', 'on'])(
    'arms hybrid when SWEET_SEARCH_LI_HYBRID=%s and no contention',
    (val) => {
      const decision = decideHybridDispatcher({
        env: { SWEET_SEARCH_LI_HYBRID: val },
        parallelLateInteraction: false,
      });
      expect(decision.armed).toBe(true);
      expect(decision.reason).toBe('ok');
    }
  );

  it('refuses hybrid when parallelLateInteraction=true (Metal contended by embed)', () => {
    const decision = decideHybridDispatcher({
      env: { SWEET_SEARCH_LI_HYBRID: '1' },
      parallelLateInteraction: true,
    });
    expect(decision.armed).toBe(false);
    expect(decision.reason).toBe('metal-contended-by-embed');
  });

  it('arms hybrid when parallelLateInteraction=true AND SWEET_SEARCH_EMBED_USE_CPU=1', () => {
    // The ORT CPU embed path frees up Metal, so hybrid CAN run even with
    // parallelLateInteraction=true — they run on different compute units.
    const decision = decideHybridDispatcher({
      env: {
        SWEET_SEARCH_LI_HYBRID: '1',
        SWEET_SEARCH_EMBED_USE_CPU: '1',
      },
      parallelLateInteraction: true,
    });
    expect(decision.armed).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('refuses hybrid when SWEET_SEARCH_LI_USE_CPU=1 (single-encoder CPU path)', () => {
    // LI_USE_CPU=1 means "route LI entirely through the CPU ORT path" — no
    // GPU encoder to dispatch to, so hybrid cannot arm.
    const decision = decideHybridDispatcher({
      env: {
        SWEET_SEARCH_LI_HYBRID: '1',
        SWEET_SEARCH_LI_USE_CPU: '1',
      },
      parallelLateInteraction: false,
    });
    expect(decision.armed).toBe(false);
    expect(decision.reason).toBe('cpu-only-forced');
  });

  it('cpu-only-forced takes precedence over metal-contended reason', () => {
    // If both conditions hold, report the earlier-terminating one. The
    // ordering matters for user-facing diagnostics: LI_USE_CPU is an
    // explicit user choice; parallelLateInteraction is a default config.
    const decision = decideHybridDispatcher({
      env: {
        SWEET_SEARCH_LI_HYBRID: '1',
        SWEET_SEARCH_LI_USE_CPU: '1',
      },
      parallelLateInteraction: true,
    });
    expect(decision.armed).toBe(false);
    expect(decision.reason).toBe('cpu-only-forced');
  });

  it('uppercase values are accepted case-insensitively', () => {
    const decision = decideHybridDispatcher({
      env: { SWEET_SEARCH_LI_HYBRID: 'TRUE' },
      parallelLateInteraction: false,
    });
    expect(decision.armed).toBe(true);
  });

  it('trims whitespace around the env value', () => {
    const decision = decideHybridDispatcher({
      env: { SWEET_SEARCH_LI_HYBRID: '  1  ' },
      parallelLateInteraction: false,
    });
    expect(decision.armed).toBe(true);
  });
});
