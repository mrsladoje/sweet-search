/**
 * Structural regression tests for the `indexer-phases.js` → `indexer-ann.js`
 * call-site wiring. These tests verify that option bags are built correctly
 * at the call site — they catch drift where a downstream function accepts
 * an option but the upstream caller forgets to pass it.
 *
 * Why structural and not behavioral: the phase runner is a deeply-nested
 * async function with native-inference and SQLite dependencies that are
 * hard to mock cleanly. A grep-shaped test is ugly but reliable — it runs
 * in <10ms, has zero mocking, and catches the exact regression we care
 * about (a future refactor silently drops a field from the options bag).
 *
 * The failure modes each test catches:
 *   - projectRoot: without this, LI skip policy loads the wrong
 *     `.sweet-search.config.json` on non-cwd invocations (CI runners,
 *     MCP tools, future daemon), so embed and LI apply different skip
 *     lists and the bde9b26 "single source of truth" refactor silently
 *     breaks. Verified fix is at indexer-phases.js line ~497.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PHASES_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../core/indexing/indexer-phases.js'),
  'utf-8'
);

describe('indexer-phases.js → buildLateInteractionIndex wiring', () => {
  it('imports PROJECT_ROOT from the infrastructure config barrel', () => {
    // Pre-condition for the projectRoot threading to work — if this
    // import is missing, the test below passes vacuously.
    expect(PHASES_SRC).toMatch(
      /from\s+['"]\.\.\/infrastructure\/config\/index\.js['"]/
    );
    expect(PHASES_SRC).toMatch(/\bPROJECT_ROOT\b/);
  });

  it('defines a buildLateInteraction factory that wraps buildLateInteractionIndex', () => {
    // This is the anchor point — if someone renames this factory, the
    // next two assertions won't apply to anything meaningful, and the
    // structural test loses its grip.
    expect(PHASES_SRC).toMatch(
      /const\s+buildLateInteraction\s*=\s*\(chunks\)\s*=>\s*buildLateInteractionIndex/
    );
  });

  it('passes projectRoot: PROJECT_ROOT to buildLateInteractionIndex', () => {
    // Extract the buildLateInteraction factory body and assert projectRoot
    // is in the options bag. This is the specific regression for the
    // 3fa180c refactor being one-hop-short: buildLateInteractionIndex
    // declares `projectRoot` as an option but indexer-phases.js forgot
    // to pass it. Fixed 2026-04-15.
    const factoryMatch = PHASES_SRC.match(
      /const\s+buildLateInteraction\s*=\s*\(chunks\)\s*=>\s*buildLateInteractionIndex\([^)]*\{([\s\S]*?)\}\);/
    );
    expect(factoryMatch).not.toBeNull();
    const optionsBag = factoryMatch[1];
    expect(optionsBag).toMatch(/projectRoot:\s*PROJECT_ROOT/);
  });

  it('passes finalIndexPath and stagingSegmentDir to prevent C1 aliasing', () => {
    // Guards the C1 fix (staged-save aliasing): without finalIndexPath and
    // stagingSegmentDir, `LateInteractionIndex.save()` would derive the
    // segment dir from indexPath and collide with the live directory.
    const factoryMatch = PHASES_SRC.match(
      /const\s+buildLateInteraction\s*=\s*\(chunks\)\s*=>\s*buildLateInteractionIndex\([^)]*\{([\s\S]*?)\}\);/
    );
    const optionsBag = factoryMatch[1];
    expect(optionsBag).toMatch(/finalIndexPath:\s*DB_PATHS\.lateInteraction/);
    expect(optionsBag).toMatch(/stagingSegmentDir:\s*stagedLateInteractionSegmentDir/);
  });
});
