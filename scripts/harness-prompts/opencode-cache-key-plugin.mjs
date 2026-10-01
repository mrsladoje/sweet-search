// opencode plugin that `sweet-search init --opencode` installs as .opencode/plugins/sweet-search-cache.mjs.
// It makes the OpenAI prompt cache sticky per repository.
//
// Why: opencode sends prompt_cache_key = session id and the headers session-id, x-session-affinity and
// X-Session-Id = session id. OpenAI routes each request by those values, so every session lands on its
// own cache shard: request 0 of a new session is cold although its prefix is byte-identical to the last
// session of the same repository, and later requests re-miss older context. Measured on opencode 1.18.4 +
// GPT (5 + 5 rollouts, ChatGPT login): one per-repo key in the body AND the three headers took the
// cache-hit share from 71.6% to 82.7%; the key alone, without the headers, was not enough.
//
// What it does, for requests to the `openai` provider only (API key or ChatGPT login; every other
// provider is left untouched):
//   chat.params   output.options.promptCacheKey = the repo key. opencode merges this object into the
//                 provider options it sends (session/llm request prep: params.options -> providerOptions),
//                 after its own default promptCacheKey = sessionID, so this works for any OpenAI model
//                 without per-model config.
//   chat.headers  session-id, x-session-affinity, X-Session-Id = the same key. opencode spreads the hook
//                 output last, over its own session headers; opencode's built-in OpenAI plugin also writes
//                 session-id in the same hook and the hook order is not ours to fix, so each value is an
//                 accessor that ignores later writes and wins in either order.
//
// Key: "ss-" + the first 16 hex digits of sha256(canonical project root), where the root is opencode's
// worktree (the git root), or its directory when there is no worktree. No path in clear.
//
// Shards: OpenAI advises about 15 requests per minute per cache key. Several opencode sessions running at
// once in one repository can spread over N keys: plugin option { "shards": N } in .opencode/opencode.json,
// or SWEET_SEARCH_OC_CACHE_SHARDS=N (the env wins). Default 1. With N > 1 each session keeps one shard
// (chosen from its session id), so its own requests still share a cache: "ss-<16 hex>-<0..N-1>".
//
// Opt-out at run time: SWEET_SEARCH_OC_CACHE_KEY=0 (or false / off / no) in opencode's environment; then
// the plugin registers no hook and opencode sends the session id as before.
//
// Self-contained (node built-ins only) and default export only: opencode treats exported functions as
// plugins.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADERS = ['session-id', 'x-session-affinity', 'X-Session-Id'];
const MAX_SHARDS = 32;
const OFF = new Set(['0', 'false', 'off', 'no']);

const sha256 = s => createHash('sha256').update(String(s)).digest('hex');

function canonical(dir) {
  try { return (realpathSync.native ?? realpathSync)(dir); } catch { return resolve(dir); }
}

function projectRoot(input) {
  const worktree = typeof input?.worktree === 'string' ? input.worktree : '';
  // opencode reports worktree "/" for a directory outside git; the directory is the project then.
  if (worktree && worktree !== '/') return worktree;
  const directory = typeof input?.directory === 'string' ? input.directory : '';
  return directory || process.cwd();
}

function shardCount(options, env) {
  const fromEnv = String(env.SWEET_SEARCH_OC_CACHE_SHARDS ?? '').trim();
  const raw = fromEnv || options?.shards;
  const n = Number.parseInt(String(raw ?? '1'), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_SHARDS) : 1;
}

// An enumerable accessor whose setter ignores later writes; configurable so a later `delete` or
// defineProperty from other code cannot throw.
function pin(obj, name, value) {
  const d = Object.getOwnPropertyDescriptor(obj, name);
  if (d && !d.configurable) return;
  Object.defineProperty(obj, name, { get: () => value, set: () => {}, enumerable: true, configurable: true });
}

const isOpenAI = input => input?.model?.providerID === 'openai';

export default async (input, options = {}) => {
  const env = process.env;
  if (OFF.has(String(env.SWEET_SEARCH_OC_CACHE_KEY ?? '').trim().toLowerCase())) return {};
  const base = `ss-${sha256(canonical(projectRoot(input))).slice(0, 16)}`;
  const shards = shardCount(options, env);
  const keyFor = sessionID => (shards > 1
    ? `${base}-${Number.parseInt(sha256(sessionID ?? '').slice(0, 8), 16) % shards}`
    : base);
  return {
    'chat.params': async (hookInput, output) => {
      if (!isOpenAI(hookInput) || !output?.options || typeof output.options !== 'object') return;
      pin(output.options, 'promptCacheKey', keyFor(hookInput.sessionID));
    },
    'chat.headers': async (hookInput, output) => {
      if (!isOpenAI(hookInput) || !output?.headers || typeof output.headers !== 'object') return;
      const key = keyFor(hookInput.sessionID);
      for (const name of HEADERS) pin(output.headers, name, key);
    },
  };
};
