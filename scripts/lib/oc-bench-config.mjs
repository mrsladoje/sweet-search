// Pure helpers for the opencode rollout config of scripts/retrieval-bench-282.mjs (final-tuning).
// Kept in a module so the $0 mock check can run exactly the runner's code.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OC_CACHE_KEY_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'opencode-cache-key-plugin.mjs');

const sha = (s, n) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);

/** Rules directory for SS_BENCH_STABLE_RULES_PATH=1: one directory per distinct rules TEXT
 *  (oc-rules-<sha8>), so arms with identical rules send the identical `Instructions from: <path>` line
 *  and share the provider prefix cache; arms with different rules still get different directories.
 *  No rules (native arm) or the switch off: the previous behaviour. */
export function opencodeRulesDir({ stable, stateRoot, stateDir, rulesText }) {
  if (!stable) return stateDir;
  if (rulesText == null) return path.join(stateRoot, 'oc-rules');
  return path.join(stateRoot, `oc-rules-${sha(rulesText, 8)}`);
}

/** One stable cache key per repo (clone basename without the eval__repos__ prefix). */
export function opencodeRepoCacheKey(cwd) {
  return 'ss-' + sha(path.basename(cwd).replace(/^eval__repos__/, ''), 16);
}

/** SS_VARIANT_OC_CACHE_KEY=repo: promptCacheKey per model option (wins over opencode's session-id key:
 *  transform.ts sets it first, request.ts mergeDeep lets model.options win) AND the routing headers via
 *  the cache-key plugin. Returns { cfg, plugin } — the plugin entry must also be passed to the preflight. */
export function applyOpencodeRepoCacheKey(cfg, { model, cwd }) {
  const [prov, ...rest] = model.split('/');
  const modelId = rest.join('/');
  const key = opencodeRepoCacheKey(cwd);
  const p = cfg.provider?.[prov] || {};
  const m = p.models?.[modelId] || {};
  const plugin = [`file://${OC_CACHE_KEY_PLUGIN}`, { key }];
  return {
    cfg: {
      ...cfg,
      plugin: [...(cfg.plugin || []), plugin],
      provider: { ...cfg.provider, [prov]: { ...p, models: { ...(p.models || {}), [modelId]: { ...m, options: { ...(m.options || {}), promptCacheKey: key } } } } },
    },
    plugin,
    key,
  };
}
