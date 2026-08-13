// GATE 5 REDO — C-9 addressability under FOUR classifiers, over the WHOLE corpus.
// The first pass used one strict classifier on one run. C-9's mechanism also allows "patching a
// tree-sitter node", which is more general than replace-body, so the strict reading may be
// unfair. Four readings, from strictest to most generous:
//
//   C1 strict     the quoted text IS a whole declaration (decl keyword + balanced brackets)
//   C2 enclosing  the intended region sits inside exactly ONE declaration in the file, found by
//                 fuzzy match, so "replace-body of <symbol>" names it unambiguously
//   C3 node       C2, plus wrong-path failures whose file resolves uniquely
//   C4 maximal    C3, plus anything whose file resolves at all (upper bound on any index editor)
//
// If even C4 misses the 90% bar the kill is safe. If C2/C3 clear it, the first verdict was wrong.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const RUNS = { claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };
const goldenDirs = readdirSync(GOLDEN);
const BASE = {
  'redboltz__mqtt_cpp-466': 'f48e140ba080e6078ad4066ae6280b5d10210521',
  'dotnet__yarp-2825': '7c46ec2cc39a731b393cee033d4a2d81c8b8e492',
  'dart-lang__http-1114': '5c75da6e084145b27c046827b89d518e30c19048',
  'dashbitco__nimble_options-43': '5270554b86676476b3e63d91f54c0d340a67102c',
  'ontodev__robot-710': '691d0dd57b97309da2e05b86bc0d6bcace1ecf78',
  'codeception__codeceptjs-367': '9ed81962765b738eaa4d6bad059ce72081547190',
  'akinsho__nvim-bufferline.lua-173': '7bf463cf7c61faa9f24222bba9412230d4cc1dc7',
  'mransan__ocaml-protoc-202': 'cc163d8eb2444363b58d7b4d43c9788b8946abd6',
  'statamic__cms-9029': 'ce8e80987e29c8929364dc8387cd0f2399128202',
  'epiforecasts__scoringutils-229': '53436b609c29c7b72016ea645601a21a8ee3564b',
  'apple__swift-nio-http2-145': '3d0b38268ecda6ba0e7a1d5aca1c3c5a20f7c42a',
  'joshuakgoldberg__bingo-274': 'aa2363da6dae89bb322beb9916358b3865bd68e4',
  'jashkenas__underscore-2757': '4bd6f69b33179517d4ff9f6020637d6f336c5f99',
  'pytask-dev__pytask-210': '30227332d58cbe0dc8a055cafd5711eb1cd653d8',
  'rstudio-education__gradethis-161': '2e64380c0e96eff7b3e3a52b0af79cdc5c6b5ec6',
  'oceanparcels__parcels-617': '762f0215ba0cea90531b5c72c8c037b056330ab0',
  'teleporthq__teleport-code-generators-291': 'ee3baaf6246efd494d6bc406a541edf9d370eacd',
};
const goldenFor = t => { const s = BASE[t]; const h = s && goldenDirs.find(d => d.endsWith(`@${s}`)); return h ? path.join(GOLDEN, h) : null; };
const fileCache = new Map();
function allFiles(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 12) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else out.push(p.slice(root.length + 1)); } };
  walk(root); return out;
}
function resolveFile(task, wanted) {
  const g = goldenFor(task); if (!g) return null;
  if (!fileCache.has(task)) fileCache.set(task, allFiles(g));
  const parts = String(wanted || '').replace(/^\/+/, '').split('/').filter(Boolean);
  for (let k = parts.length; k >= 1; k--) {
    const suf = parts.slice(parts.length - k).join('/');
    const hits = fileCache.get(task).filter(f => f === suf || f.endsWith('/' + suf));
    if (hits.length === 1) return path.join(g, hits[0]);
    if (hits.length > 1) return null;
  }
  return null;
}
const DECL = /^\s*(export\s+)?(async\s+)?(pub\s+)?(def|class|function|fn|func|const|let|var|public|private|protected|internal|static|impl|struct|enum|trait|module|defmodule|defp|sub|proc|type|interface|val|object|case|extension|local)\b|^\s*[\w.]+\s*(=|<-)\s*function\s*\(|^\s*\w+\s*\([^)]*\)\s*\{?\s*$/;

/** Fuzzy-locate the quoted text and name the single declaration that encloses it. */
function enclosingSymbol(absFile, oldStr) {
  if (!absFile || !existsSync(absFile)) return null;
  let src; try { src = readFileSync(absFile, 'utf8'); } catch { return null; }
  const fileLines = src.split('\n');
  const want = String(oldStr || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!want.length) return null;
  const norm = fileLines.map(l => l.replace(/\s+/g, ' ').trim());
  // best window: the offset maximising matched lines
  let bestI = -1, bestScore = 0;
  for (let i = 0; i < norm.length; i++) {
    let s = 0;
    for (let j = 0; j < want.length && i + j < norm.length; j++) if (norm[i + j] === want[j]) s++;
    if (s > bestScore) { bestScore = s; bestI = i; }
  }
  if (bestScore / want.length < 0.4) return { found: false };
  // nearest preceding declaration line
  let d = -1;
  for (let i = bestI; i >= 0; i--) if (DECL.test(fileLines[i])) { d = i; break; }
  if (d < 0) return { found: true, unique: false, why: 'no enclosing declaration' };
  const declText = fileLines[d].replace(/\s+/g, ' ').trim();
  const occurrences = norm.filter(l => l === declText).length;
  return { found: true, unique: occurrences === 1, decl: declText.slice(0, 70), occurrences, matchFrac: bestScore / want.length };
}

const findings = [];
for (const [h, run] of Object.entries(RUNS)) {
  const root = path.join(RESULTS, run, 'agent-state');
  if (!existsSync(root)) continue;
  const walk = (d, acc = [], depth = 0) => { if (depth > 10) return acc;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return acc; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, acc, depth + 1); else if (e.name.endsWith('.jsonl')) acc.push(p); } return acc; };
  for (const f of walk(root)) {
    if (!f.includes('/claude-home/projects/') || f.includes('/subagents/')) continue;
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const byId = new Map();
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') byId.set(b.id, b);
        if (b.type !== 'tool_result') continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        if (!b.is_error && !/^Error/i.test(txt)) continue;
        const call = byId.get(b.tool_use_id);
        if (!call || !/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name)) continue;
        const cls = /String to replace not found/i.test(txt) ? 'anchor-not-found'
          : /File does not exist/i.test(txt) ? 'wrong-path'
          : /exactly the same/i.test(txt) ? 'no-op-edit'
          : /could not be parsed as JSON/i.test(txt) ? 'oversized-payload' : 'other';
        const fp = call.input?.file_path || '';
        const abs = resolveFile(task, fp);
        const enc = cls === 'anchor-not-found' || cls === 'no-op-edit' ? enclosingSymbol(abs, call.input?.old_string) : null;
        findings.push({ h, task, arm, cls, fileResolves: !!abs, enc });
      }
    }
  }
}

const sweet = findings.filter(f => f.arm === 'sweet');
const classify = {
  'C1 strict (whole declaration)': f => f.cls === 'wrong-path' ? f.fileResolves : !!(f.enc && f.enc.found && f.enc.unique && f.enc.matchFrac >= 0.9),
  'C2 enclosing symbol unique': f => f.cls === 'wrong-path' ? f.fileResolves : !!(f.enc && f.enc.found && f.enc.unique),
  'C3 + resolvable wrong-path': f => f.cls === 'wrong-path' ? f.fileResolves : !!(f.enc && f.enc.found),
  'C4 maximal (file resolves)': f => f.fileResolves,
};
console.log(`=== C-9 addressability, sweet arm, ${RUNS.claude} + ${RUNS.screen} ===`);
console.log(`sweet edit failures: ${sweet.length}`);
const g = new Map(); for (const f of sweet) g.set(f.cls, (g.get(f.cls) || 0) + 1);
console.log('classes:', [...g].map(([k, v]) => `${k}=${v}`).join(' '), '\n');
for (const [name, fn] of Object.entries(classify)) {
  const all = sweet.filter(fn).length;
  const noBlowup = sweet.filter(f => f.cls !== 'oversized-payload');
  const nb = noBlowup.filter(fn).length;
  console.log(`${name.padEnd(32)} all ${all}/${sweet.length} = ${(all / sweet.length * 100).toFixed(0)}%   |   excl. decoding blow-ups ${nb}/${noBlowup.length} = ${(nb / noBlowup.length * 100).toFixed(0)}%   ${(nb / noBlowup.length) >= 0.9 ? '<== CLEARS 90% BAR' : ''}`);
}
console.log('\nper-failure detail (sweet, anchor/no-op only):');
for (const f of sweet.filter(x => x.enc)) {
  console.log(`  ${f.h.padEnd(7)} ${f.cls.padEnd(17)} ${f.task.padEnd(42)} found=${f.enc.found} unique=${f.enc.unique ?? '-'} match=${f.enc.matchFrac ? f.enc.matchFrac.toFixed(2) : '-'} decl="${f.enc.decl || f.enc.why || ''}"`);
}
