// WHOSE BUG IS THE WHITESPACE MISMATCH?
//
// 19 sweet against 4 native is a 4.75x arm asymmetry. If quoting whitespace wrongly were a
// model habit it would be arm-symmetric. It is not. So the question is whether the SWEET
// arm's reader -- ss-read -- renders file content in a form that does not round-trip, the
// same class of defect as C-1's line-number gutter but for whitespace.
//
// For every whitespace-mismatch failure this locates the matching region in the base file and
// reports the EXACT character-level difference between what the agent quoted and what is on
// disk. Then it checks whether the agent had seen that region through ss-read or through a
// native reader.
//
// Read-only. No model.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const RUNS = ['sb-claudecode-20260811', 'screen-v3-20260812'];
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
  'litestar-org__polyfactory-405': '63aa2729df553f49ed137e8e33c6a1a80387ca2b',
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
const norm = s => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

const transcripts = root => {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p); }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
};
const resolveInGolden = (gold, fp) => {
  if (!gold) return null;
  const rel = fp.replace(/^\/root\/\.ss-eval\/runs\/[^/]+\//, '').replace(/^\.?\//, '');
  for (const c of [rel, rel.split('/').slice(1).join('/')]) {
    if (!c) continue;
    const abs = path.join(gold, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
};

/** Find the region of `src` whose normalised form equals the normalised `quoted`, and
 *  describe how the two differ character by character. */
function diagnose(src, quoted) {
  const nq = norm(quoted);
  if (!nq) return null;
  const srcLines = src.split('\n');
  const qLines = quoted.replace(/\r/g, '').split('\n');
  // locate by matching the first non-empty normalised quoted line
  const firstQ = qLines.find(l => l.trim());
  if (!firstQ) return null;
  const key = firstQ.trim();
  for (let i = 0; i < srcLines.length; i++) {
    if (srcLines[i].trim() !== key) continue;
    const window = srcLines.slice(i, i + qLines.length).join('\n');
    if (norm(window) !== nq) continue;
    // found it -- now characterise the difference
    const diffs = new Set();
    for (let k = 0; k < qLines.length; k++) {
      const a = qLines[k] ?? '', b = srcLines[i + k] ?? '';
      if (a === b) continue;
      const ai = (a.match(/^[ \t]*/) || [''])[0], bi = (b.match(/^[ \t]*/) || [''])[0];
      if (ai !== bi) {
        if (ai.includes('\t') !== bi.includes('\t')) diffs.add('TAB<->SPACE in indent');
        else if (ai.length !== bi.length) diffs.add(`indent width ${bi.length}->${ai.length}`);
        else diffs.add('indent differs');
      }
      const at = (a.match(/[ \t]*$/) || [''])[0], bt = (b.match(/[ \t]*$/) || [''])[0];
      if (at !== bt) diffs.add(bt.length > at.length ? 'TRAILING whitespace stripped' : 'trailing whitespace added');
      if (a.trim() !== b.trim()) {
        if (a.replace(/[ \t]+/g, '') === b.replace(/[ \t]+/g, '')) diffs.add('INTERIOR whitespace run collapsed');
        else diffs.add('body text differs');
      }
    }
    return { line: i + 1, diffs: [...diffs], qLines, srcLines: srcLines.slice(i, i + qLines.length) };
  }
  return null;
}

const found = [];
for (const RUN of RUNS) {
  const root = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(root)) continue;
  for (const f of transcripts(root)) {
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const gold = goldenFor(task);
    const byId = new Map();
    const lines = readFileSync(f, 'utf8').split('\n');
    // how did this rollout read files? collect reader tool usage
    let ssRead = 0, nativeRead = 0;
    const readerOutputs = [];   // {via, text}
    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') {
          byId.set(b.id, { name: b.name, input: b.input });
          if (b.name === 'Read') nativeRead++;
          else if (b.name === 'Bash' && /\bss-read\b/.test(String(b.input?.command || ''))) ssRead++;
        }
        if (b.type === 'tool_result') {
          const call = byId.get(b.tool_use_id); if (!call) continue;
          const txt = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
          const via = call.name === 'Read' ? 'native-Read'
            : (call.name === 'Bash' && /\bss-read\b/.test(String(call.input?.command || ''))) ? 'ss-read' : null;
          if (via) readerOutputs.push({ via, text: txt });
        }
      }
    }
    // now the failures
    const byId2 = new Map();
    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') byId2.set(b.id, { name: b.name, input: b.input });
        if (b.type !== 'tool_result') continue;
        const call = byId2.get(b.tool_use_id); if (!call) continue;
        if (!/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name)) continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        if (!(b.is_error || /^Error|error:/i.test(txt))) continue;
        if (!/String to replace not found|not found in file/i.test(txt)) continue;
        const oldStr = String(call.input?.old_string ?? call.input?.edits?.[0]?.old_string ?? '');
        const abs = resolveInGolden(gold, String(call.input?.file_path || ''));
        if (!abs) continue;
        const src = readFileSync(abs, 'utf8');
        if (src.includes(oldStr)) continue;
        if (!(oldStr.trim() && norm(src).includes(norm(oldStr)))) continue;
        const d = diagnose(src, oldStr);
        // did any reader output contain the exact source region? which reader?
        const srcRegion = d ? d.srcLines.join('\n') : null;
        let sawExact = null;
        if (srcRegion) {
          for (const r of readerOutputs) {
            if (r.text.includes(srcRegion)) { sawExact = r.via; break; }
          }
          if (!sawExact) {
            const nq = norm(srcRegion);
            for (const r of readerOutputs) if (norm(r.text).includes(nq)) { sawExact = r.via + ' (normalised only)'; break; }
          }
        }
        found.push({ run: RUN, arm, task, tool: call.name, ssRead, nativeRead,
          file: path.basename(String(call.input?.file_path || '')), d, sawExact });
      }
    }
  }
}

console.log('=== WHOSE BUG? whitespace-mismatch failures, character-level ===\n');
console.log(`population: ${found.length} located whitespace-mismatch failures\n`);

const kinds = new Map();
for (const x of found) for (const k of (x.d?.diffs || ['unlocated'])) {
  const key = `${k}|${x.arm}`;
  kinds.set(key, (kinds.get(key) || 0) + 1);
}
const allKinds = [...new Set([...kinds.keys()].map(k => k.split('|')[0]))];
console.log(`  ${'difference'.padEnd(34)} native  sweet`);
for (const k of allKinds.sort()) {
  console.log(`  ${k.padEnd(34)} ${String(kinds.get(k + '|native') || 0).padStart(5)}  ${String(kinds.get(k + '|sweet') || 0).padStart(5)}`);
}

console.log('\n=== WAS THE EXACT SOURCE REGION EVER ON SCREEN, AND VIA WHICH READER? ===\n');
const seen = new Map();
for (const x of found) {
  const k = `${x.arm}|${x.sawExact || 'NEVER shown exactly'}`;
  seen.set(k, (seen.get(k) || 0) + 1);
}
for (const [k, v] of [...seen].sort()) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log('\n=== READER USAGE IN THE AFFECTED ROLLOUTS ===\n');
for (const x of found.slice(0, 40)) {
  console.log(`  ${x.arm.padEnd(6)} ${x.task.padEnd(30)} ${x.file.padEnd(24)} ss-read=${String(x.ssRead).padStart(2)} nativeRead=${String(x.nativeRead).padStart(2)}  diffs=[${(x.d?.diffs || []).join('; ')}]  sawExactVia=${x.sawExact || 'never'}`);
}

console.log('\n=== FIRST THREE CASES, RAW ===');
for (const x of found.slice(0, 3)) {
  if (!x.d) continue;
  console.log(`\n--- ${x.arm} ${x.task} ${x.file} @ base line ${x.d.line} ---`);
  for (let i = 0; i < Math.min(6, x.d.qLines.length); i++) {
    const q = JSON.stringify(x.d.qLines[i]);
    const s = JSON.stringify(x.d.srcLines[i]);
    console.log(`   quoted: ${q}`);
    console.log(`   ondisk: ${s}   ${q === s ? '' : '   <-- DIFFERS'}`);
  }
}
