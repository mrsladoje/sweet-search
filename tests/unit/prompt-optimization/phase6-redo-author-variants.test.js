/**
 * Unit tests for core/prompt-optimization/scripts/author-variants.mjs.
 *
 * Focused on the orchestration loop: validator failure → re-prompt, JSON
 * parsing fallbacks, and prompt construction. The DeepSeek client itself
 * is mocked (it's tested in deepseek-client.test.js).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  authorOneVariant,
  buildUserPrompt,
  SYSTEM_PROMPT,
} from '../../../core/prompt-optimization/scripts/author-variants.mjs';

const RS_001 = {
  goldId: 'RS-001',
  goldClass: 'ast-tester',
  expectedFile: 'crates/ruff_linter/src/rules/isort/categorize.rs',
  expectedSymbol: 'ImportType',
  expectedSymbolType: 'enum',
  language: 'rust',
  canonicalLanguage: 'rust',
  family: 'Systems-modular-terse',
  goldNotes: 'NL behavior query targeting isort categorization',
  sourceSnippet: { text: 'pub enum ImportType { Future, StandardLibrary }', startLine: 25, endLine: 30 },
  pathTokens: ['crates', 'ruff', 'linter', 'src', 'rules', 'isort', 'categorize', 'rs'],
};

const RS_008 = {
  goldId: 'RS-008',
  goldClass: 'ast-tester',
  expectedFile: 'crates/ruff_linter/src/packaging.rs',
  expectedSymbol: 'detect_package_root',
  language: 'rust',
  canonicalLanguage: 'rust',
  family: 'Systems-modular-terse',
  sourceSnippet: { text: 'pub fn detect_package_root(...) {}', startLine: 35, endLine: 47 },
  pathTokens: ['crates', 'ruff', 'linter', 'src', 'packaging', 'rs'],
};

function makeClient(contents) {
  // Each call to chat() returns one entry from `contents` in order.
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const c = contents[Math.min(i, contents.length - 1)];
      i++;
      return { content: c, attempts: 1, rawResponse: {} };
    }),
  };
}

describe('buildUserPrompt', () => {
  it('includes file, symbol, shape, length rule, and forbidden tokens', () => {
    const prompt = buildUserPrompt(RS_008, 'V3');
    expect(prompt).toContain('crates/ruff_linter/src/packaging.rs');
    expect(prompt).toContain('detect_package_root');
    expect(prompt).toContain('V3');
    expect(prompt).toContain('9-15 tokens'); // length rule for V3
    expect(prompt).toContain('packaging'); // §5.5.5 path-leak forbidden tokens for this gold
    expect(prompt).toContain('declarative noun-phrase');
  });

  it('uses interrogative framing for V2 with-symbol', () => {
    const prompt = buildUserPrompt(RS_001, 'V2');
    expect(prompt).toContain('V2');
    expect(prompt).toContain('4-8 tokens');
    expect(prompt).toContain('MUST contain the symbol "ImportType" verbatim');
    expect(prompt).toContain('interrogative');
  });

  it('uses long-NL bound for V6', () => {
    const prompt = buildUserPrompt(RS_001, 'V6');
    expect(prompt).toContain('≥ 16 tokens');
  });

  it('SYSTEM_PROMPT pins JSON-only output (no markdown fences)', () => {
    expect(SYSTEM_PROMPT).toContain('No markdown fences');
    expect(SYSTEM_PROMPT).toContain('No prose outside the JSON object');
  });
});

describe('authorOneVariant — happy path', () => {
  it('returns parsed variant when first response validates', async () => {
    const client = makeClient([
      JSON.stringify({ query: 'where is ImportType enum defined', rationale: 'anchored' }),
    ]);
    const result = await authorOneVariant({ client, input: RS_001, shape: 'V2' });
    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(1);
    expect(result.parsed.query).toBe('where is ImportType enum defined');
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('parses JSON when the model wraps it in extraneous text', async () => {
    const client = makeClient([
      'Sure, here you go: {"query":"ImportType","rationale":"short"}',
    ]);
    const result = await authorOneVariant({ client, input: RS_001, shape: 'V1' });
    expect(result.ok).toBe(true);
    expect(result.parsed.query).toBe('ImportType');
  });
});

describe('authorOneVariant — re-prompt on validator failure', () => {
  it('retries with the §5.5.5 re-prompt prefix when first attempt fails length', async () => {
    const client = makeClient([
      JSON.stringify({ query: 'find ImportType in ruff isort module please', rationale: 'too long' }), // 7 tokens but should be ≤ 3 for V1
      JSON.stringify({ query: 'ImportType', rationale: 'short' }),
    ]);
    const result = await authorOneVariant({ client, input: RS_001, shape: 'V1' });
    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
    expect(client.chat).toHaveBeenCalledTimes(2);
    const secondCall = client.chat.mock.calls[1][0];
    expect(secondCall.userPrompt).toContain('Your previous attempt');
    expect(secondCall.userPrompt).toContain('rejected because');
  });

  it('returns ok=false after MAX_RETRIES persistent failures', async () => {
    const client = makeClient([
      JSON.stringify({ query: 'too short', rationale: 'x' }),
      JSON.stringify({ query: 'still wrong', rationale: 'x' }),
      JSON.stringify({ query: 'nope again', rationale: 'x' }),
    ]);
    const result = await authorOneVariant({ client, input: RS_001, shape: 'V1' });
    expect(result.ok).toBe(false);
    expect(client.chat).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result.lastReason).toBeTruthy();
  });

  it('REJECTS V3 path-token-leak ("packaging") and re-prompts', async () => {
    const client = makeClient([
      JSON.stringify({
        query: 'helper that walks ancestor dirs for python packaging markers',
        rationale: 'first',
      }),
      JSON.stringify({
        query: 'helper that walks ancestor directories looking for python module markers',
        rationale: 'second',
      }),
    ]);
    const result = await authorOneVariant({ client, input: RS_008, shape: 'V3' });
    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
    expect(result.parsed.query).toMatch(/directories/);
  });

  it('returns ok=false on unparseable JSON after retries', async () => {
    const client = makeClient([
      'this is not json',
      'still no braces here',
      'and not now either',
    ]);
    const result = await authorOneVariant({ client, input: RS_001, shape: 'V2' });
    expect(result.ok).toBe(false);
    expect(result.lastReason).toMatch(/JSON/);
  });
});
