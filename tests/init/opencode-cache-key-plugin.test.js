/**
 * The per-repo OpenAI prompt-cache key plugin (scripts/harness-prompts/opencode-cache-key-plugin.mjs)
 * that `sweet-search init --opencode` installs as .opencode/plugins/sweet-search-cache.mjs. The hooks
 * are driven the way opencode 1.18.x calls them: `chat.params` with the merged provider options as
 * output.options, `chat.headers` with an empty headers object that opencode spreads over its own
 * session headers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as pluginModule from '../../scripts/harness-prompts/opencode-cache-key-plugin.mjs';

const plugin = pluginModule.default;
const ENV_KEYS = ['SWEET_SEARCH_OC_CACHE_KEY', 'SWEET_SEARCH_OC_CACHE_SHARDS'];
const HEADERS = ['session-id', 'x-session-affinity', 'X-Session-Id'];

let root;
let saved;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-oc-cache-key-'));
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const expectedKey = dir => `ss-${createHash('sha256').update(realpathSync.native(dir)).digest('hex').slice(0, 16)}`;
const hookInput = (providerID, sessionID = 'ses_A', agent = 'build') => ({
  sessionID, agent, model: { providerID, id: 'm' }, provider: { info: { id: providerID } }, message: {},
});

// options: what opencode 1.18.4 merged before the hook: { store: false, promptCacheKey: sessionID, ... }
// for an openai conversation request; no promptCacheKey for a title request or with setCacheKey: false.
async function params(hooks, providerID, sessionID, { agent = 'build', options } = {}) {
  const output = {
    temperature: undefined, topP: undefined, topK: undefined, maxOutputTokens: 1,
    options: options ?? { store: false, promptCacheKey: sessionID },
  };
  await hooks['chat.params']?.(hookInput(providerID, sessionID, agent), output);
  return output;
}
async function headers(hooks, providerID, sessionID, { before = {}, after = {}, agent = 'build' } = {}) {
  const output = { headers: { ...before } };
  await hooks['chat.headers']?.(hookInput(providerID, sessionID, agent), output);
  Object.assign(output.headers, after);   // a hook that runs after ours, e.g. opencode's built-in OpenAI plugin
  // opencode 1.18.4: { 'x-session-affinity': sid, 'X-Session-Id': sid, 'User-Agent', ...model.headers, ...hookHeaders }
  return { 'x-session-affinity': sessionID, 'X-Session-Id': sessionID, 'User-Agent': 'opencode/1.18.4', ...output.headers };
}

describe('opencode cache-key plugin', () => {
  it('exports only the default plugin function (opencode loads every exported function as a plugin)', () => {
    expect(Object.keys(pluginModule)).toEqual(['default']);
  });

  it('openai: promptCacheKey and the three session headers carry one per-repo key', async () => {
    const hooks = await plugin({ worktree: root, directory: root });
    const key = expectedKey(root);
    expect(key).toMatch(/^ss-[0-9a-f]{16}$/);
    expect(key).not.toContain(root);
    for (const sid of ['ses_A', 'ses_B']) {
      const out = await params(hooks, 'openai', sid);
      expect(out.options.promptCacheKey).toBe(key);
      expect(out.options.store).toBe(false);
      expect(JSON.parse(JSON.stringify({ ...out.options })).promptCacheKey).toBe(key);   // copies keep the value
      const h = await headers(hooks, 'openai', sid);
      for (const name of HEADERS) expect(h[name]).toBe(key);
      expect(h['User-Agent']).toBe('opencode/1.18.4');
    }
  });

  it('wins over a hook that writes the same fields before or after it', async () => {
    const hooks = await plugin({ worktree: root, directory: root });
    const key = expectedKey(root);
    const h = await headers(hooks, 'openai', 'ses_A', {
      before: { 'session-id': 'ses_A', originator: 'opencode' },
      after: { 'session-id': 'ses_A', 'x-session-affinity': 'ses_A', 'X-Session-Id': 'ses_A' },
    });
    for (const name of HEADERS) expect(h[name]).toBe(key);
    expect(h.originator).toBe('opencode');
    const out = await params(hooks, 'openai', 'ses_A');
    out.options.promptCacheKey = 'ses_A';
    expect(out.options.promptCacheKey).toBe(key);
    expect(() => { delete out.options.promptCacheKey; }).not.toThrow();
  });

  it('title requests go out as opencode sends them (no prompt_cache_key, session headers)', async () => {
    const hooks = await plugin({ worktree: root, directory: root });
    const out = await params(hooks, 'openai', 'ses_A', { agent: 'title', options: { store: false } });
    expect(out.options).toEqual({ store: false });
    const h = await headers(hooks, 'openai', 'ses_A', { agent: 'title', after: { 'session-id': 'ses_A' } });
    for (const name of HEADERS) expect(h[name]).toBe('ses_A');
    // The session's next conversation request still gets the repo key.
    expect((await params(hooks, 'openai', 'ses_A')).options.promptCacheKey).toBe(expectedKey(root));
    expect((await headers(hooks, 'openai', 'ses_A'))['session-id']).toBe(expectedKey(root));
  });

  it('a promptCacheKey the user set, or none (setCacheKey: false), is kept, and so are that request\'s headers', async () => {
    const hooks = await plugin({ worktree: root, directory: root });
    for (const options of [{ store: false, promptCacheKey: 'my-team-key' }, { store: false }]) {
      const out = await params(hooks, 'openai', 'ses_U', { options: { ...options } });
      expect(out.options).toEqual(options);
      const h = await headers(hooks, 'openai', 'ses_U', { after: { 'session-id': 'ses_U' } });
      for (const name of HEADERS) expect(h[name]).toBe('ses_U');
    }
    // Other sessions are not affected, and the same session follows its latest request.
    expect((await headers(hooks, 'openai', 'ses_V'))['session-id']).toBe(expectedKey(root));
    expect((await params(hooks, 'openai', 'ses_U')).options.promptCacheKey).toBe(expectedKey(root));
    expect((await headers(hooks, 'openai', 'ses_U'))['x-session-affinity']).toBe(expectedKey(root));
  });

  it('leaves every other provider untouched', async () => {
    const hooks = await plugin({ worktree: root, directory: root });
    for (const providerID of ['openrouter', 'anthropic', 'azure', 'deepseek', 'github-copilot', 'opencode']) {
      const out = await params(hooks, providerID, 'ses_A');
      expect(out.options).toEqual({ store: false, promptCacheKey: 'ses_A' });
      const h = await headers(hooks, providerID, 'ses_A');
      expect(h).toEqual({ 'x-session-affinity': 'ses_A', 'X-Session-Id': 'ses_A', 'User-Agent': 'opencode/1.18.4' });
    }
  });

  it('key: the canonical git root; the directory when opencode reports no worktree; symlinks resolve', async () => {
    const sub = join(root, 'pkg');
    mkdirSync(sub);
    const fromSub = await plugin({ worktree: root, directory: sub });
    expect((await params(fromSub, 'openai', 's')).options.promptCacheKey).toBe(expectedKey(root));
    for (const worktree of ['/', '', undefined]) {
      const noGit = await plugin({ worktree, directory: sub });
      expect((await params(noGit, 'openai', 's')).options.promptCacheKey).toBe(expectedKey(sub));
    }
    const link = join(mkdtempSync(join(tmpdir(), 'ss-oc-link-')), 'repo');
    symlinkSync(root, link);
    const viaLink = await plugin({ worktree: link, directory: link });
    expect((await params(viaLink, 'openai', 's')).options.promptCacheKey).toBe(expectedKey(root));
    rmSync(join(link, '..'), { recursive: true, force: true });
    const other = mkdtempSync(join(tmpdir(), 'ss-oc-other-'));
    const otherHooks = await plugin({ worktree: other, directory: other });
    expect((await params(otherHooks, 'openai', 's')).options.promptCacheKey).not.toBe(expectedKey(root));
    rmSync(other, { recursive: true, force: true });
  });

  it('SWEET_SEARCH_OC_CACHE_KEY=0 / false / off / no: no hooks, opencode sends the session id as before', async () => {
    for (const v of ['0', 'false', 'OFF', ' no ']) {
      process.env.SWEET_SEARCH_OC_CACHE_KEY = v;
      const hooks = await plugin({ worktree: root, directory: root });
      expect(hooks).toEqual({});
      expect((await params(hooks, 'openai', 'ses_A')).options.promptCacheKey).toBe('ses_A');
      const h = await headers(hooks, 'openai', 'ses_A', { after: { 'session-id': 'ses_A' } });
      for (const name of HEADERS) expect(h[name]).toBe('ses_A');
    }
    for (const v of ['', '1', 'on']) {
      process.env.SWEET_SEARCH_OC_CACHE_KEY = v;
      const hooks = await plugin({ worktree: root, directory: root });
      expect((await params(hooks, 'openai', 'ses_A')).options.promptCacheKey).toBe(expectedKey(root));
    }
  });

  it('shards: one key per session, N keys over many sessions; env wins over the plugin option', async () => {
    const base = expectedKey(root);
    const sessions = Array.from({ length: 64 }, (_, i) => `ses_${i}`);
    const keysOf = async hooks => Promise.all(sessions.map(async s => (await params(hooks, 'openai', s)).options.promptCacheKey));

    const four = await plugin({ worktree: root, directory: root }, { shards: 4 });
    const keys = await keysOf(four);
    expect(new Set(keys)).toEqual(new Set([0, 1, 2, 3].map(i => `${base}-${i}`)));
    expect(await keysOf(four)).toEqual(keys);   // stable per session
    const h = await headers(four, 'openai', 'ses_7');
    for (const name of HEADERS) expect(h[name]).toBe(keys[7]);   // headers follow the session's shard

    process.env.SWEET_SEARCH_OC_CACHE_SHARDS = '2';
    expect(new Set(await keysOf(await plugin({ worktree: root }, { shards: 4 })))).toEqual(new Set([`${base}-0`, `${base}-1`]));
    process.env.SWEET_SEARCH_OC_CACHE_SHARDS = '';
    expect(new Set(await keysOf(await plugin({ worktree: root }, { shards: 4 }))).size).toBe(4);
    delete process.env.SWEET_SEARCH_OC_CACHE_SHARDS;

    process.env.SWEET_SEARCH_OC_CACHE_SHARDS = 'many';   // not a number: the plugin option applies
    expect(new Set(await keysOf(await plugin({ worktree: root }, { shards: 4 }))).size).toBe(4);
    delete process.env.SWEET_SEARCH_OC_CACHE_SHARDS;

    for (const shards of [undefined, 1, 0, -3, 'x']) {
      expect(new Set(await keysOf(await plugin({ worktree: root }, { shards })))).toEqual(new Set([base]));
    }
    expect(new Set(await keysOf(await plugin({ worktree: root }, { shards: 1000 }))).size).toBeLessThanOrEqual(32);
  });
});
