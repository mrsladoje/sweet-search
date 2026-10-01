#!/usr/bin/env node
// $0 mechanism check for V3 (SS_VARIANT_SEARCH_DEDUPE): replay r282 sweet-arm ss-search calls in their
// r282 clones with the switch off / on and compare output size (chars) and dropped entries.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const WT = '/Users/admin/Projects/sweet-search-final-tuning';
const BIN = path.join(WT, 'eval/agent-read-workflows/bin');
const TRACE = path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace');
const { resolveRepoCwd } = await import(path.join(WT, 'core/prompt-optimization/sweep/gepa-evaluate.mjs'));
const PROBES = new Map(['core/prompt-optimization/data/frozen/p7-vault-probes-v60.json', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'].flatMap(f => { const raw = JSON.parse(fs.readFileSync(path.join(WT, f), 'utf8')); return Array.isArray(raw) ? raw : raw.probes; }).map(p => [p.id, p]));
const cloneName = (id) => path.relative(WT, resolveRepoCwd(PROBES.get(id), {})).replace(/[\\/]/g, '__');
const out = [];
for (const cell of ['oc-dsflash41', 'codex-sol61-high', 'cc-opus55-medium']) {
  const recs = fs.readFileSync(path.join(TRACE, `${cell}.trace.jsonl`), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const calls = recs.filter(r => r.arm === 'sweet' && r.type !== 'rollout').flatMap(r => (r.calls || []).filter(c => c.tool === 'ss-search').map(c => ({ id: r.id, c })));
  const sample = calls.filter((_, i) => i % Math.max(1, Math.floor(calls.length / 20)) === 0).slice(0, 20);
  for (const { id, c } of sample) {
    const m = String(c.argText).match(/ss-search\s+(.*)$/s); if (!m) continue;
    const cloneRoot = path.join(process.env.HOME, '.ss-eval/r282-repos', cell);
    const cwd = path.join(cloneRoot, cloneName(id));
    if (!fs.existsSync(cwd)) { out.push({ cell, id, skipped: 'no clone ' + cwd }); continue; }
    const run = (v) => { try { return execFileSync('bash', ['-lc', `ss-search ${m[1]}`], { cwd, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, SWEET_SEARCH_PROJECT_ROOT: cwd, SWEET_SEARCH_OFFLINE: '1', SS_VARIANT_SEARCH_DEDUPE: v }, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return String(e.stdout || ''); } };
    const a = run('0'), b = run('1');
    out.push({ cell, id, off: a.length, on: b.length, entriesOff: (a.match(/^## #/gm) || []).length, entriesOn: (b.match(/^## #/gm) || []).length });
  }
}
const ok = out.filter(x => x.off > 0);
const tot = (k) => ok.reduce((s, x) => s + x[k], 0);
console.log(JSON.stringify({ n: ok.length, skipped: out.length - ok.length, charsOff: tot('off'), charsOn: tot('on'), reductionPct: +(100 * (1 - tot('on') / tot('off'))).toFixed(1), entriesOff: tot('entriesOff'), entriesOn: tot('entriesOn') }, null, 1));
fs.writeFileSync(path.join(WT, 'core/prompt-optimization/data/final-tuning/variants/replay-dedupe.json'), JSON.stringify(out, null, 1));
