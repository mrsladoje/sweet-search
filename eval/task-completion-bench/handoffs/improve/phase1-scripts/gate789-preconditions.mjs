// GATES 7-9 preconditions, measured WITHOUT reading any gold patch.
//
// (a) C-6 premise: are the modules the issue asks for absent from the BASE tree? (base only)
// (b) C-8 precondition: is the stored patch pool DIVERSE on the exposed tasks? A tournament
//     referee can only help if the candidates differ on the disputed dimension. If every arm
//     and rep converges on the same patch, there is nothing to select between.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };

console.log('=== (a) C-6 premise: bingo base tree ===');
const bingo = readdirSync(GOLDEN).find(d => d.startsWith('JoshuaKGoldberg__bingo@aa2363da'));
console.log('base checkout:', bingo || 'ABSENT');
if (bingo) {
  const root = path.join(GOLDEN, bingo);
  const all = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else all.push(p.slice(root.length + 1)); } };
  walk(root);
  console.log(`files in base tree: ${all.length}`);
  for (const want of ['isFile.ts', 'handlebarsDirectory.ts', 'handlebarsFile.ts', 'handlebars.ts']) {
    const hits = all.filter(f => f.endsWith('/' + want) || f === want);
    console.log(`  ${want.padEnd(26)} ${hits.length ? 'PRESENT at base: ' + hits.join(', ') : 'ABSENT at base'}`);
  }
  const pkgs = all.filter(f => /^packages\/[^/]+\/package\.json$/.test(f)).map(f => f.split('/')[1]);
  console.log(`  packages: ${pkgs.join(', ')}`);
}

console.log('\n=== (b) C-8 precondition: patch diversity on the six both-arms-unsolved tasks ===');
const HARD = ['apple__swift-nio-http2-145', 'codeception__codeceptjs-367', 'dart-lang__http-1114',
  'joshuakgoldberg__bingo-274', 'mransan__ocaml-protoc-202', 'dashbitco__nimble_options-43',
  'pytask-dev__pytask-210'];
const norm = p => String(p || '')
  .split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
  .map(l => l.replace(/\s+/g, ' ').trim()).join('\n');
const byTask = new Map();
for (const [h, run] of Object.entries(RUNS)) {
  for (const arm of ['native', 'sweet']) {
    const f = path.join(RESULTS, run, `preds-${arm}.jsonl`);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!HARD.includes(o.instance_id)) continue;
      const p = o.model_patch || '';
      const filesTouched = [...p.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
      const newFiles = [...p.matchAll(/^--- \/dev\/null[\s\S]*?^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
      const k = o.instance_id;
      if (!byTask.has(k)) byTask.set(k, []);
      byTask.get(k).push({ h, arm, sha: crypto.createHash('sha1').update(norm(p)).digest('hex').slice(0, 8),
        bytes: p.length, files: filesTouched, newFiles });
    }
  }
}
for (const t of HARD) {
  const rs = byTask.get(t) || [];
  if (!rs.length) { console.log(`\n${t}: no stored patches`); continue; }
  const uniq = new Set(rs.map(r => r.sha));
  const fileSets = new Set(rs.map(r => r.files.slice().sort().join('|')));
  console.log(`\n${t}: ${rs.length} stored patches, ${uniq.size} distinct patch bodies, ${fileSets.size} distinct file sets`);
  const anyNew = rs.filter(r => r.newFiles.length);
  console.log(`   patches that CREATE a new file: ${anyNew.length}/${rs.length}${anyNew.length ? ' -> ' + [...new Set(anyNew.flatMap(r => r.newFiles))].join(', ') : ''}`);
  const seen = new Set();
  for (const r of rs) {
    const key = r.files.slice().sort().join('|');
    if (seen.has(key)) continue; seen.add(key);
    console.log(`   [${r.h}/${r.arm}] ${r.files.length} file(s): ${r.files.slice(0, 6).join(', ')}${r.files.length > 6 ? ' …' : ''}`);
  }
}
