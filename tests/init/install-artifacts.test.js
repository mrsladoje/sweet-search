/**
 * The one list of installed artifacts (scripts/install-artifacts.js): its removers report "nothing
 * there" on an empty repo, and the tracked paths are the union of what its entries create.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_ARTIFACTS, TRACKED_CREATED_PATHS, artifactsInPlanOrder, artifactsInRunOrder,
} from '../../scripts/install-artifacts.js';

let tmpRoot;
beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-artifacts-')); });
afterEach(() => { if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); });

describe('PROJECT_ARTIFACTS', () => {
  it('has one entry per id, with distinct plan and run ranks', () => {
    const ids = PROJECT_ARTIFACTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(artifactsInPlanOrder().map((a) => a.planRank)).toEqual(ids.map((_, i) => i + 1));
    expect(artifactsInRunOrder().map((a) => a.runRank)).toEqual(ids.map((_, i) => i + 1));
  });

  it('finds nothing to remove in an empty repo', () => {
    for (const artifact of PROJECT_ARTIFACTS) {
      expect(artifact.remove(tmpRoot, { dryRun: true }).status, artifact.id).not.toBe('dry-run');
      expect(artifact.report(artifact.remove(tmpRoot)), artifact.id).toEqual([]);
    }
  });

  it('tracks the harness paths in the order the created-paths record keeps', () => {
    expect(TRACKED_CREATED_PATHS).toEqual([
      '.claude', '.claude/settings.json', '.claude/skills', '.claude/rules',
      '.claude/agents', '.claude/output-styles', '.cursor', '.cursor/rules',
    ]);
  });
});
