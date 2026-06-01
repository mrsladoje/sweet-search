#!/usr/bin/env node
/**
 * M++ consistency analysis — BOTH targets.
 * M++ runs come from the fresh mpp-53x3.json; the M* BASELINE is pulled from
 * EXISTING trajectory files (no re-run) — dev40-PM + Mstar-reverify + rot13-PMA.
 *
 * Questions:
 *   - Does M++ hold M*'s accuracy (per target, per stratum)?  [floor — non-negotiable]
 *   - Is cost ~neutral? (M++ is a correctness pass, not a cut)
 *   - CANARY: did the TRIMMED flooding line hold js-009 (and js-rot-01)?
 *   - Did stripping [[ ]] / rewording shift raw-shell or tool behavior?
 *   - Integrity: any still-empty runs?
 *
 * NOTE: the M* baseline is from prior runs (not freshly paired), so mild
 * index/harness drift is possible; flagged rather than re-paid.
 *
 *   node scripts/analyze-mpp.mjs [mppResultsFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const mppFile = process.argv[2] || path.join(RES, 'mpp-53x3.json');

const load = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).runs || []; } catch { return []; } };

// M++ (fresh) + M* baseline from existing corpora
const mpp = load(mppFile).filter((r) => r.cand === 'Mpp');
const BASELINE_FILES = ['dev40-PM-trajectories.json', 'Mstar-reverify.json', 'rot13-PMA-trajectories.json'];
const mstar = BASELINE_FILES.flatMap((f) => load(path.join(RES, f))).filter((r) => r.cand === 'Mstar');
const all = [...mpp, ...mstar];

const RAW = ['grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'cat', 'less', 'more', 'ls', 'head', 'tail', 'sed', 'awk', 'wc', 'tree', 'nl', 'cut'];
const isRaw = (cmd) => typeof cmd === 'string' && cmd.split(/&&|\|\||;/).some((s) => RAW.includes((s.trim().split(/\s+/)[0] || '').replace(/^.*\//, '')));
const rawCalls = (r) => (r.toolCalls || []).filter((c) => isRaw(c.input?.command)).length;
const emits = (r) => /state_summary/i.test(String(r.answer || ''));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const TARGETS = ['sonnet', 'gpt5_5'];
const STRATA = ['literal-lookup', 'multi-file-flow', 'behavioral', 'no-match'];
const CANDS = ['Mpp', 'Mstar'];
const base = 'Mstar', cand = 'Mpp';

console.log(`\n═══ M++ (fresh) vs M* (existing baseline) ═══`);
console.log(`  M++ runs: ${mpp.length}  |  M* baseline runs: ${mstar.length} (from ${BASELINE_FILES.join(' + ')})`);

for (const tg of TARGETS) {
  const T = all.filter((r) => r.target === tg);
  if (!T.length) continue;
  console.log(`\n━━━━━━ target=${tg} ━━━━━━`);
  const empties = mpp.filter((r) => r.target === tg && r.stillEmpty);
  if (empties.length) console.log(`  ⚠️  STILL-EMPTY (M++): ${empties.length} runs — corrupt cells, re-run before trusting`);

  for (const k of CANDS) {
    const rs = T.filter((r) => r.cand === k);
    if (!rs.length) continue;
    const rawPct = 100 * rs.reduce((x, r) => x + rawCalls(r), 0) / Math.max(1, rs.reduce((x, r) => x + (r.callCount || 0), 0));
    console.log(`  ${k.padEnd(6)} acc=${mean(rs.map((r) => r.score)).toFixed(3)}  calls=${mean(rs.map((r) => r.callCount)).toFixed(2)}  $=${mean(rs.map((r) => r.cost || 0)).toFixed(4)}/run  raw=${rawPct.toFixed(1)}%  summary=${(100 * rs.filter(emits).length / rs.length).toFixed(0)}%  (n=${rs.length})`);
  }

  console.log(`  — paired Δ (M++ minus M*, per-probe means) —`);
  for (const s of [null, ...STRATA]) {
    const probes = [...new Set(T.filter((r) => !s || r.stratum === s).map((r) => r.probeId))];
    const dA = [], dC = [], dD = [];
    for (const p of probes) {
      const b = T.filter((r) => r.cand === base && r.probeId === p);
      const x = T.filter((r) => r.cand === cand && r.probeId === p);
      if (!b.length || !x.length) continue;
      dA.push(mean(x.map((r) => r.score)) - mean(b.map((r) => r.score)));
      dC.push(mean(x.map((r) => r.callCount)) - mean(b.map((r) => r.callCount)));
      dD.push(mean(x.map((r) => r.cost || 0)) - mean(b.map((r) => r.cost || 0)));
    }
    const bD = mean(T.filter((r) => r.cand === base && (!s || r.stratum === s)).map((r) => r.cost || 0));
    console.log(`     ${(s || 'ALL').padEnd(16)} Δacc=${mean(dA) >= 0 ? '+' : ''}${mean(dA).toFixed(3)}  Δcalls=${mean(dC) >= 0 ? '+' : ''}${mean(dC).toFixed(2)}  Δ$=${mean(dD) >= 0 ? '+' : ''}${mean(dD).toFixed(4)} (${bD ? (100 * mean(dD) / bD).toFixed(1) : '–'}%)   [paired probes=${dA.length}]`);
  }

  console.log(`  — CANARIES (trimmed flooding line / reworded tools) —`);
  for (const pid of ['js-009', 'js-rot-01', 'csharp-004', 'cpp-002']) {
    const line = CANDS.map((k) => {
      const rs = T.filter((r) => r.cand === k && r.probeId === pid);
      return rs.length ? `${k}=${mean(rs.map((r) => r.score)).toFixed(2)}/c${mean(rs.map((r) => r.callCount)).toFixed(1)}` : `${k}=–`;
    }).join('  ');
    console.log(`     ${pid.padEnd(11)} ${line}`);
  }
}
