import { describe, expect, it } from 'vitest';
import {
  applyResultDemotions,
  extractNameHints,
  isFileHeaderChunk,
  isTestSupportFile,
} from '../../core/ranking/file-kind-ranking.js';

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

  it('does not demote a normal file header followed by real code', () => {
    const content = [
      ...Array.from({ length: 50 }, (_, i) => `// API docs line ${i}`),
      'package binding',
      'import "net/http"',
      'func SelectBinding(method string) Binding {',
      '  if method == http.MethodGet {',
      '    return Form',
      '  }',
      '  return JSON',
      '}',
    ].join('\n');

    expect(isFileHeaderChunk({
      file: 'binding/default.go',
      startLine: 1,
      endLine: 58,
      content,
      metadata: { file: 'binding/default.go', startLine: 1, endLine: 58 },
    })).toBe(false);
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
      ablations: new Set(['no-tiny-floor']),
    });

    expect(ranked[0].metadata.type).toBe('enum');
    expect(ranked.find(r => r.metadata.type === 'function')._resultDemotionDetails)
      .not.toContain('name-precision:1.20');
  });

  it('covers Go, Rust, JS, and Python rule fixtures', () => {
    expect(isFileHeaderChunk({
      file: 'pkg/bind.go',
      startLine: 1,
      endLine: 8,
      content: 'package bind\n\nimport (\n  "net/http"\n  "strings"\n)\n',
    })).toBe(true);

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
