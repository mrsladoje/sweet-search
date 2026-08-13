// GATE 9 REDO — C-8 patch-pool diversity at a FINER GRAIN.
// The first pass measured diversity by FILE SET and concluded "a referee has nothing to choose
// between". That measure is too coarse: 8 patches can share one file set and still differ
// semantically. Re-measure at three grains and let the strongest reading of the pool stand:
//   1. added-line sets, with pairwise Jaccard similarity
//   2. hunk anchors (the @@ context lines) — which regions of the file each patch touches
//   3. identifier-level: which distinct symbols each patch introduces or references
// A pool is degenerate only if patches are near-identical on ALL THREE.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };
const HARD = ['apple__swift-nio-http2-145', 'joshuakgoldberg__bingo-274', 'dashbitco__nimble_options-43',
  'codeception__codeceptjs-367', 'pytask-dev__pytask-210', 'dart-lang__http-1114', 'mransan__ocaml-protoc-202'];

const added = p => new Set(String(p).split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
  .map(l => l.slice(1).replace(/\s+/g, ' ').trim()).filter(Boolean));
const removed = p => new Set(String(p).split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'))
  .map(l => l.slice(1).replace(/\s+/g, ' ').trim()).filter(Boolean));
const hunks = p => new Set([...String(p).matchAll(/^@@[^@]*@@\s*(.*)$/gm)].map(m => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean));
const idents = p => new Set([...String(p).split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
  .join('\n').matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)].map(m => m[1]));
const jac = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

const pool = new Map();
for (const [h, run] of Object.entries(RUNS)) {
  for (const arm of ['native', 'sweet']) {
    const f = path.join(RESULTS, run, `preds-${arm}.jsonl`);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!HARD.includes(o.instance_id)) continue;
      if (!pool.has(o.instance_id)) pool.set(o.instance_id, []);
      pool.get(o.instance_id).push({ h, arm, patch: o.model_patch || '' });
    }
  }
}

console.log('=== C-8 patch-pool diversity, three grains ===\n');
console.log('A pool is degenerate only if patches are near-identical on ALL THREE grains.');
console.log('Jaccard is the MEAN pairwise similarity; 1.00 = identical, 0.00 = disjoint.\n');
console.log('task                                          n  addedJ  removedJ  hunkJ  identJ  distinct-added-sets');
const verdicts = [];
for (const t of HARD) {
  const rs = pool.get(t) || [];
  if (rs.length < 2) { console.log(`${t.padEnd(44)} ${rs.length}  (too few)`); continue; }
  const A = rs.map(r => added(r.patch)), R = rs.map(r => removed(r.patch));
  const H = rs.map(r => hunks(r.patch)), I = rs.map(r => idents(r.patch));
  const mean = (S) => { let s = 0, n = 0; for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { s += jac(S[i], S[j]); n++; } return s / n; };
  const distinct = new Set(A.map(s => [...s].sort().join(''))).size;
  const aJ = mean(A), rJ = mean(R), hJ = mean(H), iJ = mean(I);
  verdicts.push({ t, n: rs.length, aJ, rJ, hJ, iJ, distinct });
  console.log(`${t.padEnd(44)} ${String(rs.length).padStart(2)}   ${aJ.toFixed(2)}    ${rJ.toFixed(2)}     ${hJ.toFixed(2)}   ${iJ.toFixed(2)}   ${distinct}/${rs.length}`);
}

console.log('\n=== reading ===');
for (const v of verdicts) {
  const degenerate = v.aJ >= 0.8 && v.hJ >= 0.8 && v.iJ >= 0.8;
  const diverse = v.aJ < 0.5;
  console.log(`${v.t.padEnd(44)} ${degenerate ? 'DEGENERATE pool — nothing to select between'
    : diverse ? 'DIVERSE pool — a referee has real candidates'
    : 'PARTLY diverse — same region, different content'}`);
}

console.log('\n=== apple: what each patch actually changes (the disputed dimension) ===');
for (const r of (pool.get('apple__swift-nio-http2-145') || [])) {
  const a = [...added(r.patch)].filter(l => l.length > 3).slice(0, 3);
  console.log(`  [${r.h}/${r.arm}] +${added(r.patch).size} -${removed(r.patch).size} lines | ${a.join(' ~ ').slice(0, 150)}`);
}
console.log('\n=== bingo: does any patch add an export or a new symbol? ===');
for (const r of (pool.get('joshuakgoldberg__bingo-274') || [])) {
  const ad = [...added(r.patch)];
  console.log(`  [${r.h}/${r.arm}] +${ad.length} lines | exports: ${ad.filter(l => /^export /.test(l)).length} | ${ad.filter(l => /^export /.test(l)).slice(0, 2).join(' ~ ').slice(0, 120)}`);
}
