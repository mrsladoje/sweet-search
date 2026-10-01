// Pure helpers for the opencode rollout config of scripts/retrieval-bench-282.mjs (final-tuning).
// Kept in a module so the $0 mock check can run exactly the runner's code.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// ─── SS_VARIANT_OC_CACHE_KEY=product ──────────────────────────────────────────────────────────────
// The PRODUCT cache-key plugin (main: scripts/harness-prompts/opencode-cache-key-plugin.mjs), which
// `sweet-search init --opencode` installs as .opencode/plugins/sweet-search-cache.mjs and lists in
// `plugin` with no options, after the tool-description plugin. The bench copies the file from the main
// checkout once per run into the run's state dir and lists it the same way (plain string, no options,
// after the trim plugin). No per-model promptCacheKey and no bench header plugin in this mode: the
// product plugin sets both itself (chat.params + chat.headers, openai provider only).
export const OC_PRODUCT_CACHE_PLUGIN_REL = 'scripts/harness-prompts/opencode-cache-key-plugin.mjs';
export const OC_PRODUCT_CACHE_PLUGIN_FILE = 'sweet-search-cache.mjs';
export const OC_CACHE_KEY_MODES = ['repo', 'product'];

/** The main checkout: SS_PRODUCT_MAIN_DIR, else the worktree of `repo` that has branch main checked out. */
export function mainCheckoutDir(repo, { env = process.env, exec = execFileSync } = {}) {
  if (env.SS_PRODUCT_MAIN_DIR) return path.resolve(env.SS_PRODUCT_MAIN_DIR);
  const out = exec('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  for (const block of out.split('\n\n')) {
    const wt = /^worktree (.+)$/m.exec(block)?.[1];
    if (wt && /^branch refs\/heads\/main$/m.test(block)) return wt;
  }
  throw new Error('SS_VARIANT_OC_CACHE_KEY=product: no worktree of this repo has main checked out (set SS_PRODUCT_MAIN_DIR)');
}

/** Copy the product plugin from the main checkout into <stateRoot>/oc-cache-plugin/. Returns the plugin
 *  entry (`file://` URL string, as init lists it: no options) plus provenance for the rows. */
export function stageProductCachePlugin({ repo, stateRoot, env = process.env }) {
  const main = mainCheckoutDir(repo, { env });
  const src = path.join(main, OC_PRODUCT_CACHE_PLUGIN_REL);
  const text = fs.readFileSync(src, 'utf8');
  const dir = path.join(stateRoot, 'oc-cache-plugin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, OC_PRODUCT_CACHE_PLUGIN_FILE);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
    const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
  }
  let commit = null;
  try { commit = execFileSync('git', ['-C', main, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* provenance only */ }
  const dirty = (() => { try { return execFileSync('git', ['-C', main, 'status', '--porcelain', '--', OC_PRODUCT_CACHE_PLUGIN_REL], { encoding: 'utf8' }).trim() !== ''; } catch { return null; } })();
  return { plugin: `file://${file}`, file, src, sha: sha(text, 12), commit, dirty };
}

/** SS_VARIANT_OC_CACHE_KEY=product: the staged product plugin appended to `plugin` (after the trim
 *  plugin), nothing else. Returns { cfg, plugin } — the plugin entry must also be passed to the preflight. */
export function applyOpencodeProductCacheKey(cfg, { plugin }) {
  return { cfg: { ...cfg, plugin: [...(cfg.plugin || []), plugin] }, plugin };
}
