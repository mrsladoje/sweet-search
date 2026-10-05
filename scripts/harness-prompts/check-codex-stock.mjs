#!/usr/bin/env node
// check-codex-stock.mjs — release check: is each captured Codex stock text still what Codex sends?
//
//   node scripts/harness-prompts/check-codex-stock.mjs [--codex-home <dir>]
//
// init builds the Codex prompt from the user's own $CODEX_HOME/models_cache.json when it can; the captured
// copies (CODEX_STOCK_CAPTURED) are the fallback and the benchmark's default arm. When a Codex release
// changes a model's stock text, the copy no longer matches the stock prefix every Codex session warms, and
// the fallback prompt misses OpenAI's prompt cache again. Run with an up-to-date Codex (one session so the
// cache refreshes) before a release; exit 1 = re-capture the copy (and re-pin its sha in the tests).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_STOCK_CAPTURED, codexCapturedStock } from './index.js';

const i = process.argv.indexOf('--codex-home');
const codexHome = i > 0 ? process.argv[i + 1] : (process.env.CODEX_HOME || join(homedir(), '.codex'));
let cache;
try { cache = JSON.parse(readFileSync(join(codexHome, 'models_cache.json'), 'utf8')); } catch (e) {
  console.error(`no readable ${join(codexHome, 'models_cache.json')} (${e.message}); run one Codex session first`); process.exit(2);
}
let bad = 0;
for (const model of Object.keys(CODEX_STOCK_CAPTURED)) {
  const live = (cache.models || []).find(m => m.slug === model)?.model_messages?.instructions_template;
  if (typeof live !== 'string') { console.log(`${model}: not in the cache of codex ${cache.client_version ?? '?'} (cannot check)`); continue; }
  const same = live === codexCapturedStock(model);
  if (!same) bad++;
  console.log(`${model}: ${same ? 'OK' : 'DIFFERS'} (codex ${cache.client_version ?? '?'}, cache fetched ${cache.fetched_at ?? '?'})`);
}
process.exit(bad ? 1 : 0);
