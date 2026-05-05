import { describe, expect, it } from 'vitest';
import {
  applyResultDemotions,
  extractNameHints,
  isTestSupportFile,
} from '../../core/ranking/file-kind-ranking.js';

// Note: `isFileHeaderChunk` and `isTinyAncillaryChunk` were removed
// (2026-05-05) once cAST sibling-merge in tree-sitter-provider.js made
// those rules structurally redundant. Their canaries below are kept as
// behavioural assertions on the path that remains: anti-overfit on
// test-support detection + name-precision boosts.

describe('anti-overfit scoring canaries', () => {
  it('does not flag runtime-assertion modules as test-support', () => {
    const jsRuntimeChecks = [
      'import assert from "node:assert";',
      'export function validateConfig(value) {',
      '  assert.ok(value);',
      '  assert.ok(value.name);',
      '  assert.ok(value.root);',
      '  assert.ok(value.mode);',
      '  return value;',
      '}',
    ].join('\n');

    expect(isTestSupportFile('src/runtime/invariants.js', jsRuntimeChecks)).toBe(false);
  });

  it('does not boost a function named Mode for an enum Mode query', () => {
    const method = {
      file: 'src/mode.rs',
      name: 'Mode',
      type: 'function',
      score: 0.90,
      content: 'fn Mode() {}',
      metadata: { file: 'src/mode.rs', name: 'Mode', type: 'function', startLine: 20, endLine: 22 },
    };
    const enumDecl = {
      file: 'src/mode.rs',
      name: 'OtherMode',
      type: 'enum',
      score: 0.80,
      content: 'enum OtherMode { Search }',
      metadata: { file: 'src/mode.rs', name: 'OtherMode', type: 'enum', startLine: 1, endLine: 5 },
    };

    const ranked = applyResultDemotions([method, enumDecl], {
      query: 'enum Mode',
    });

    expect(ranked[0].metadata.type).toBe('enum');
    expect(ranked.find(r => r.metadata.type === 'function')._resultDemotionDetails)
      .not.toContain('name-precision:1.20');
  });

  it('covers Go, Rust, JS, and Python rule fixtures', () => {
    expect(isTestSupportFile(
      'crates/searcher/src/testutil.rs',
      '#![cfg(test)]\npub fn fixture() {}\n',
    )).toBe(true);

    expect(isTestSupportFile(
      'test/helpers/mock-server.js',
      'export function mockServer() { return {}; }\n',
    )).toBe(true);

    expect(isTestSupportFile(
      'tests/conftest.py',
      'import pytest\n@pytest.fixture\ndef client():\n    return object()\n',
    )).toBe(true);

    expect([...extractNameHints('what enum represents output Mode')]).toContain('Mode');
  });
});
