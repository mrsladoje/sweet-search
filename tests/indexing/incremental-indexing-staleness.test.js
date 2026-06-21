/**
 * Tests for core/incremental-indexing/infrastructure/staleness-display.mjs
 *
 * Plan § 19.1 three-tier alert + footer formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  stalenessTier,
  formatStalenessFooter,
  renderStalenessLines,
} from '../../core/incremental-indexing/infrastructure/staleness-display.mjs';

describe('staleness-display', () => {
  it('classifies green when fresh and clean', () => {
    expect(stalenessTier({ ageMs: 5_000, dirtyFiles: 0, maintenanceBacklog: 0 })).toBe('green');
  });

  it('classifies yellow at age 90s with 0 dirty', () => {
    expect(stalenessTier({ ageMs: 90_000, dirtyFiles: 0, maintenanceBacklog: 0 })).toBe('yellow');
  });

  it('classifies yellow with 2 dirty even when fresh', () => {
    expect(stalenessTier({ ageMs: 1_000, dirtyFiles: 2, maintenanceBacklog: 0 })).toBe('yellow');
  });

  it('classifies red past 5 minutes', () => {
    expect(stalenessTier({ ageMs: 350_000, dirtyFiles: 0, maintenanceBacklog: 0 })).toBe('red');
  });

  it('classifies red on backlog regardless of age', () => {
    expect(stalenessTier({ ageMs: 1_000, dirtyFiles: 0, maintenanceBacklog: 10 })).toBe('red');
  });

  it('hides the footer when green and not forced', () => {
    expect(formatStalenessFooter({
      epoch: 5,
      ageMs: 1_000,
      dirtyFiles: 0,
      maintenanceBacklog: 0,
    })).toBe('');
  });

  it('forceShow renders even at green', () => {
    const s = formatStalenessFooter({
      epoch: 5,
      ageMs: 1_000,
      dirtyFiles: 0,
      maintenanceBacklog: 0,
      forceShow: true,
    });
    expect(s).toContain('index epoch: 5');
  });

  it('includes the maintenance summary when set', () => {
    const s = formatStalenessFooter({
      epoch: 12,
      ageMs: 120_000,
      dirtyFiles: 1,
      lastMaintenanceTier: 'binary_hnsw',
      lastMaintenanceAgeMs: 240_000,
      maintenanceBacklog: 2,
    });
    expect(s).toContain('last maintenance: binary_hnsw');
    expect(s).toContain('backlog: 2');
  });

  it('renderStalenessLines emits the separator only when the footer renders', () => {
    expect(renderStalenessLines({
      epoch: 1, ageMs: 100, dirtyFiles: 0, maintenanceBacklog: 0,
    })).toEqual([]);
    const lines = renderStalenessLines({
      epoch: 1, ageMs: 200_000, dirtyFiles: 0, maintenanceBacklog: 0,
    });
    expect(lines[0]).toBe('─────────');
    expect(lines[1]).toContain('index epoch: 1');
  });

  it('red tier message prefixes with the warning glyph', () => {
    const s = formatStalenessFooter({
      epoch: 1, ageMs: 500_000, dirtyFiles: 0, maintenanceBacklog: 0,
    });
    expect(s.startsWith('[sweet-search] ⚠ stale index')).toBe(true);
  });
});
