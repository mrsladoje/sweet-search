#!/usr/bin/env node
/**
 * Provenance-safe cost augmentation for p7-native-baseline-dev-3panel.json
 * (2026-05-29 scoring overhaul).
 *
 * The committed 3-panel is a MULTI-RUN COMPOSITE (surgical re-measurements merged
 * into a base), so we cannot trust any single source JSONL. Instead we augment by
 * VALUE-MATCHING: for each committed (target, probe), find the result JSONL row(s)
 * that exactly reproduce its (score, calls, tokens), and lift that row's
 * cache-naive {processedInput, output} (recomputed via agentUsageBreakdown — the
 * SAME function the live candidate runner uses, so both sides are on equal
 * footing). A probe is augmented only when a matching row exists AND all matching
 * rows agree on the breakdown; otherwise it is left untouched (it keeps the legacy
 * tokens-only path). Dry-run by default; pass --write to persist.
 *
 * Usage:
 *   node scripts/regen-native-baseline-cost.mjs              # report coverage
 *   node scripts/regen-native-baseline-cost.mjs --write      # persist if complete
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentUsageBreakdown } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { normalizeTarget } from '../core/prompt-optimization/sweep/p7-shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PANEL = path.join(REPO, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json');
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const WRITE = process.argv.includes('--write');

const approx = (a, b, eps) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;

function indexRows() {
  const idx = new Map(); // `${target}:${probe}` → [{score,calls,tokens,processedInput,output}]
  for (const d of fs.readdirSync(RESULTS)) {
    const dir = path.join(RESULTS, d);
    let stat; try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const fn of fs.readdirSync(dir)) {
      if (!/baseline\.jsonl$/.test(fn)) continue;
      let rows;
      try { rows = fs.readFileSync(path.join(dir, fn), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { continue; }
      for (const r of rows) {
        if (typeof r.probe_id !== 'string' || r.target == null) continue;
        if (!(typeof r.score === 'number' && typeof r.calls === 'number' && typeof r.tokens === 'number')) continue;
        let t; try { t = normalizeTarget(String(r.target)); } catch { continue; }
        const bd = agentUsageBreakdown({ agent: {
          input_tokens: r.input_tokens, output_tokens: r.output_tokens,
          cache_read_tokens: r.cache_read_tokens, cache_creation_tokens: r.cache_creation_tokens,
        } });
        if (!bd) continue;
        const key = `${t}:${r.probe_id}`;
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push({ score: r.score, calls: r.calls, tokens: r.tokens, ...bd });
      }
    }
  }
  return idx;
}

function main() {
  const panel = JSON.parse(fs.readFileSync(PANEL, 'utf8'));
  const idx = indexRows();
  let total = 0; let augmented = 0; const misses = []; const ambiguous = [];

  for (const target of Object.keys(panel)) {
    for (const probe of Object.keys(panel[target])) {
      total += 1;
      const want = panel[target][probe];
      const cands = (idx.get(`${normalizeTarget(target)}:${probe}`) || []).filter((r) =>
        approx(r.score, want.score, 1e-6) && approx(r.calls, want.calls, 0.5) && approx(r.tokens, want.tokens, 1));
      if (cands.length === 0) { misses.push(`${target}.${probe}`); continue; }
      const distinct = new Set(cands.map((c) => `${Math.round(c.processedInput)}:${Math.round(c.output)}`));
      if (distinct.size > 1) { ambiguous.push(`${target}.${probe}`); continue; }
      want.processedInput = Math.round(cands[0].processedInput);
      want.output = Math.round(cands[0].output);
      augmented += 1;
    }
  }

  console.log(`coverage: ${augmented}/${total} probes augmented with {processedInput, output}`);
  if (misses.length) console.log(`  no value-match (${misses.length}): ${misses.slice(0, 8).join(', ')}${misses.length > 8 ? ', …' : ''}`);
  if (ambiguous.length) console.log(`  ambiguous breakdown (${ambiguous.length}): ${ambiguous.slice(0, 8).join(', ')}${ambiguous.length > 8 ? ', …' : ''}`);

  if (!WRITE) { console.log('\n(dry-run — pass --write to persist; will only write at 100% unambiguous coverage)'); return; }
  if (augmented !== total) {
    console.error(`\nREFUSING to write: coverage ${augmented}/${total} < 100%. Re-measure the baseline with the augmented producer instead (it now emits processedInput/output natively).`);
    process.exit(1);
  }
  fs.writeFileSync(PANEL, JSON.stringify(panel, null, 2) + '\n');
  console.log(`\nwrote ${PANEL} (all ${total} probes carry cache-naive cost fields)`);
}

main();
