/**
 * Unit tests for eval/agent-read-workflows/judge-runner.js — the
 * cross-lineage dispatcher used by Track B's PRP panel and IAA probes.
 *
 * Subprocess + HTTP are mocked through `_internal.spawn` / `_internal.fetch`
 * so the tests are hermetic; we DO NOT shell out to claude / codex / gemini /
 * opencode here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  parseJudgeModelSpec,
  parseCodexOutput,
  parseGeminiOutput,
  parseOpencodeOutput,
  parseClaudeJsonOutput,
  buildDeepseekPayload,
  parseDeepseekResponse,
  runJudge,
  _internal,
} from '../../../eval/agent-read-workflows/judge-runner.js';

// ─── parseJudgeModelSpec ─────────────────────────────────────────────────

describe('parseJudgeModelSpec', () => {
  it('explicit lineage:model form takes precedence', () => {
    expect(parseJudgeModelSpec('anthropic:claude-sonnet-4-6')).toEqual({
      lineage: 'anthropic', model: 'claude-sonnet-4-6',
    });
    expect(parseJudgeModelSpec('deepseek-api:deepseek-v4-pro')).toEqual({
      lineage: 'deepseek-api', model: 'deepseek-v4-pro',
    });
  });

  it('prefix heuristic: claude- / sonnet / opus / haiku → anthropic', () => {
    expect(parseJudgeModelSpec('sonnet').lineage).toBe('anthropic');
    expect(parseJudgeModelSpec('claude-opus-4-7').lineage).toBe('anthropic');
    expect(parseJudgeModelSpec('haiku-4-5').lineage).toBe('anthropic');
  });

  it('prefix heuristic: gpt- / o1- / o3- → openai (codex)', () => {
    expect(parseJudgeModelSpec('gpt-5.5').lineage).toBe('openai');
    expect(parseJudgeModelSpec('o3-pro').lineage).toBe('openai');
  });

  it('prefix heuristic: gemini- → google', () => {
    expect(parseJudgeModelSpec('gemini-3-1-pro').lineage).toBe('google');
    expect(parseJudgeModelSpec('gemini-3-flash').lineage).toBe('google');
  });

  it('prefix heuristic: flash/prose aliases → google', () => {
    expect(parseJudgeModelSpec('flash').lineage).toBe('google');
    expect(parseJudgeModelSpec('pro').lineage).toBe('google');
  });

  it('prefix heuristic: deepseek- → deepseek (CLI-harness via claude)', () => {
    expect(parseJudgeModelSpec('deepseek-v4-pro')).toEqual({
      lineage: 'deepseek', model: 'deepseek-v4-pro',
    });
  });

  it('prefix heuristic: llama / qwen / mistral / command → opencode', () => {
    expect(parseJudgeModelSpec('llama-4-instruct-70b').lineage).toBe('opencode');
    expect(parseJudgeModelSpec('qwen3.6-max').lineage).toBe('opencode');
  });

  it('throws on unresolvable bare token', () => {
    expect(() => parseJudgeModelSpec('foo-bar')).toThrow(/cannot infer lineage/);
  });

  it('throws on unknown explicit lineage', () => {
    expect(() => parseJudgeModelSpec('cohere:command-r')).toThrow(/unknown lineage/);
  });
});

// ─── output parsers ──────────────────────────────────────────────────────

describe('parseCodexOutput', () => {
  it('pulls the last text-bearing event', () => {
    const stdout = [
      '{"type":"start"}',
      '{"text":"interim"}',
      '{"text":"final answer"}',
    ].join('\n');
    expect(parseCodexOutput(stdout)).toBe('final answer');
  });

  it('handles content-block (anthropic-like) form', () => {
    const stdout = '{"content":[{"type":"text","text":"hello"}]}\n';
    expect(parseCodexOutput(stdout)).toBe('hello');
  });

  it('skips non-JSON noise', () => {
    const stdout = 'init line\n{"text":"ok"}\nrandom\n';
    expect(parseCodexOutput(stdout)).toBe('ok');
  });
});

describe('parseGeminiOutput', () => {
  it('parses single-object envelope', () => {
    const stdout = JSON.stringify({ response: 'hello', stats: {} });
    expect(parseGeminiOutput(stdout)).toBe('hello');
  });

  it('parses candidates (Gemini API shape)', () => {
    const stdout = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'part1' }, { text: 'part2' }] } }],
    });
    expect(parseGeminiOutput(stdout)).toBe('part1part2');
  });

  it('falls back to JSONL stream', () => {
    const stdout = '{"delta":{"text":"a"}}\n{"response":"final"}\n';
    expect(parseGeminiOutput(stdout)).toBe('final');
  });
});

describe('parseOpencodeOutput', () => {
  it('parses single-envelope JSON', () => {
    expect(parseOpencodeOutput(JSON.stringify({ text: 'hi' }))).toBe('hi');
  });

  it('parses messages array', () => {
    const stdout = JSON.stringify({ messages: [{ content: 'x' }, { content: 'y' }] });
    expect(parseOpencodeOutput(stdout)).toBe('y');
  });

  it('falls back to raw stdout when JSON unavailable', () => {
    expect(parseOpencodeOutput('plain text reply')).toBe('plain text reply');
  });
});

describe('parseClaudeJsonOutput (DeepSeek-via-claude path)', () => {
  it('parses single-envelope `result` field', () => {
    expect(parseClaudeJsonOutput(JSON.stringify({ result: 'x' }))).toBe('x');
  });

  it('parses stream-json assistant blocks', () => {
    const stdout = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello "}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"world"}]}}',
      '{"type":"result","result":"hello world"}',
    ].join('\n');
    expect(parseClaudeJsonOutput(stdout)).toBe('hello world');
  });
});

// ─── DeepSeek raw API (payload + response) ──────────────────────────────

describe('buildDeepseekPayload', () => {
  it('emits OpenAI-compatible {model, messages}', () => {
    const p = buildDeepseekPayload({ model: 'deepseek-v4-pro', systemPrompt: 's', userPrompt: 'u' });
    expect(p.model).toBe('deepseek-v4-pro');
    expect(p.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(p.temperature).toBe(0);                // judging is deterministic
    expect(p.stream).toBe(false);
  });

  it('omits system message when systemPrompt is empty', () => {
    const p = buildDeepseekPayload({ userPrompt: 'u' });
    expect(p.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('defaults model to deepseek-v4-pro', () => {
    const p = buildDeepseekPayload({ userPrompt: 'u' });
    expect(p.model).toBe('deepseek-v4-pro');
  });
});

describe('parseDeepseekResponse', () => {
  it('extracts choices[0].message.content', () => {
    const r = parseDeepseekResponse({
      choices: [{ message: { content: 'reply' } }],
    });
    expect(r).toBe('reply');
  });

  it('returns empty on missing choices', () => {
    expect(parseDeepseekResponse({})).toBe('');
    expect(parseDeepseekResponse(null)).toBe('');
  });
});

// ─── runJudge dispatch (mocked spawn / fetch) ───────────────────────────

function fakeSpawnSuccess(stdout) {
  return () => {
    const ee = new EventEmitter();
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    ee.kill = () => {};
    setImmediate(() => {
      ee.stdout.emit('data', Buffer.from(stdout));
      ee.emit('exit', 0);
    });
    return ee;
  };
}

describe('runJudge dispatch', () => {
  let originalSpawn;
  let originalFetch;

  beforeEach(() => {
    originalSpawn = _internal.spawn;
    originalFetch = _internal.fetch;
  });

  afterEach(() => {
    _internal.spawn = originalSpawn;
    _internal.fetch = originalFetch;
  });

  it('openai (codex) routes through spawn and parses JSONL stdout', async () => {
    _internal.spawn = fakeSpawnSuccess('{"text":"verdict"}\n');
    const r = await runJudge({
      lineage: 'openai', model: 'gpt-5.5',
      systemPrompt: 'sys', userPrompt: 'usr',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('verdict');
    expect(r.lineage).toBe('openai');
  });

  it('google (gemini) routes through spawn and parses single-envelope JSON', async () => {
    _internal.spawn = fakeSpawnSuccess(JSON.stringify({ response: 'gemini reply' }));
    const r = await runJudge({
      lineage: 'google', model: 'gemini-3-1-pro',
      systemPrompt: '', userPrompt: 'q',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('gemini reply');
  });

  it('opencode routes through spawn with --model and parses envelope', async () => {
    _internal.spawn = fakeSpawnSuccess(JSON.stringify({ text: 'oc reply' }));
    const r = await runJudge({
      lineage: 'opencode', model: 'qwen/qwen3.6-max',
      systemPrompt: 'sys', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('oc reply');
  });

  it('deepseek (CLI-harness) routes through claude spawn with redirected env', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _internal.spawn = fakeSpawnSuccess(JSON.stringify({ result: 'ds reply' }));
    const r = await runJudge({
      lineage: 'deepseek', model: 'deepseek-v4-pro',
      systemPrompt: 's', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('ds reply');
    expect(r.raw.viaHarness).toBe('claude-cli');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('deepseek-api routes through fetch and parses choices', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'api reply' } }],
        usage: { prompt_tokens: 10 },
      }),
    }));
    const r = await runJudge({
      lineage: 'deepseek-api', model: 'deepseek-v4-pro',
      systemPrompt: 's', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('api reply');
    expect(r.raw.viaHarness).toBe('raw-api');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('deepseek-api errors when DEEPSEEK_API_KEY is unset', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const r = await runJudge({
      lineage: 'deepseek-api', model: 'deepseek-v4-pro',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/DEEPSEEK_API_KEY/);
  });

  it('unknown lineage returns isError', async () => {
    const r = await runJudge({
      lineage: 'martian', model: 'm',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/unknown lineage/);
  });

  it('non-OK HTTP from deepseek-api returns isError with status', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _internal.fetch = async () => ({
      ok: false, status: 401,
      text: async () => 'unauthorized',
    });
    const r = await runJudge({
      lineage: 'deepseek-api', model: 'deepseek-v4-pro',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(401);
    delete process.env.DEEPSEEK_API_KEY;
  });
});
