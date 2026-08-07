#!/usr/bin/env node
// $0 failure taxonomy of a run's LOSSES. Picks the next resolution lever from our own
// data instead of a guess. Run it per arm: whether a class is arm-specific or universal
// decides whether a lever closes the native-vs-sweet gap or merely raises a shared floor.
//
// Per unresolved sweet rollout, exactly one class (first match wins):
//   no-edit-stall        the agent never produced a source edit
//   over-edit-past-green a verified-green edited state existed and the final edited
//                        state is a different, non-green one (the checkpoint trigger)
//   incompleteness       0 < f2pFrac < 1 — a partial fix; some target tests pass
//   wrong-location       f2pFrac == 0 and the patch touches NONE of the gold files
//   wrong-fix            f2pFrac == 0, the patch touches gold files, still no target passes
// and one orthogonal flag:
//   generation-variance  the same task+arm resolved in another rep of this run
//                        (so retrieval and prompt were sufficient; this rep just missed)
//
// Touched files come from the raw rollout's apply_patch payloads, which is per-rollout and
// exact; rows.json only carries a count.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const RUN = arg('run');
const TASKS = arg('tasks', `${BENCH}/select/.cache/tasks_full_luna_rotate20.json`);
const ARM = arg('arm', 'sweet');
const EMPTY_DIFF = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const specs = JSON.parse(readFileSync(TASKS, 'utf8'));
const goldFiles = new Map(specs.map(s => [s.instance_id,
  new Set((String(s.patch || '').match(/^\+\+\+ b\/(.+)$/gm) || []).map(l => l.slice(6).trim()))]));

// Does the F2P test NAME pre-exist at the base commit? Its run_tests runs BASE-commit
// tests, so an F2P test that test_patch ADDS can never be observed.
// LIMITATION — this is a NECESSARY, not sufficient, condition for observability: a name
// that pre-exists may still be discriminated only by an assertion test_patch adds
// (underscore's groupBy/countBy are exactly that). So 'name-pre-exists' is an UPPER
// bound on what the agent could see, never a claim that it could see it.
const f2pVisible = new Map(specs.map(s => {
  const added = String(s.test_patch || '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const names = (s.FAIL_TO_PASS || []).map(t => String(t).split(/[:#]/).filter(Boolean).at(-1) || String(t));
  const introduced = names.filter(n => n.length >= 3 && added.some(l => l.includes(n)));
  return [s.instance_id, introduced.length === 0 ? 'visible' : (introduced.length === names.length ? 'invisible' : 'partly')];
}));

// What did run_tests tell the agent on its LAST call? Distinguishes "submitted believing
// it was green" (no usable signal) from "submitted knowing it was red" (gave up).
function finalVerdict(rolloutFile) {
  let last = 'none';
  for (const line of readFileSync(rolloutFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const p = e.payload;
    if (!p || (p.type !== 'custom_tool_call_output' && p.type !== 'function_call_output')) continue;
    const text = Array.isArray(p.output) ? p.output.map(x => x?.text || '').join('') : String(p.output || '');
    const b = /\[run_tests baseline-diff\] verdict=(\w+) .*?trustworthy=(\w+)/.exec(text);
    if (b) last = `${b[1]}${b[2] === 'yes' ? '' : '(untrusted)'}`;
  }
  return last;
}

// files the agent's apply_patch payloads touched, repo-relative
function touchedFiles(rolloutFile) {
  const files = new Set();
  for (const line of readFileSync(rolloutFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const p = e.payload;
    if (p?.type !== 'custom_tool_call' || p.name !== 'exec') continue;
    const input = typeof p.input === 'string' ? p.input : JSON.stringify(p.input);
    for (const m of input.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\\"\n]+)/g)) {
      const rel = /__r\d+__\d+\/(.+)$/.exec(m[1]);
      files.add((rel ? rel[1] : m[1]).trim());
    }
  }
  return files;
}

// verified-green states + the trigger, same definition as the exposure census
function greenState(rolloutFile, runDir, task, arm, rep) {
  const dedupFile = path.join(runDir, 'rt-dedup', `${task}-${arm}.jsonl`);
  const byRep = new Map(); let cur = null;
  if (existsSync(dedupFile)) {
    for (const line of readFileSync(dedupFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.kind === 'session') { cur = []; byRep.set(/__r(\d+)__/.exec(r.rundir || '')?.[1] ?? String(byRep.size), cur); continue; }
      if (cur) cur.push(r);
    }
  }
  const records = byRep.get(String(rep)) || [];
  const footers = [];
  for (const line of readFileSync(rolloutFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const p = e.payload;
    if (!p || (p.type !== 'custom_tool_call_output' && p.type !== 'function_call_output')) continue;
    const text = Array.isArray(p.output) ? p.output.map(x => x?.text || '').join('') : String(p.output || '');
    const v = /\[run_tests verdict\] status=(\w+) scope=(\w+)/.exec(text);
    const b = /\[run_tests baseline-diff\] verdict=(\w+) introduced_failures=(\d+) pre_existing_failures=(\d+) trustworthy=(\w+)/.exec(text);
    if (v || b) footers.push({ scope: v?.[2], verdict: b?.[1], introduced: b ? Number(b[2]) : null, trustworthy: b?.[4] === 'yes' });
  }
  const n = Math.min(footers.length, records.length);
  const states = [];
  for (let i = 0; i < n; i++) {
    const green = footers[i].scope === 'full' && footers[i].trustworthy && footers[i].introduced === 0
      && footers[i].verdict === 'PASS' && records[i].diffBytes > 0 && records[i].diffSha !== EMPTY_DIFF;
    const last = states.at(-1);
    if (last && last.diff === records[i].diffSha) { last.green = last.green || green; continue; }
    states.push({ diff: records[i].diffSha, bytes: records[i].diffBytes, green });
  }
  const edited = states.filter(s => s.bytes > 0 && s.diff !== EMPTY_DIFF);
  const greens = edited.filter(s => s.green);
  const lastEdited = edited.at(-1) || null;
  return {
    observable: n > 0,
    fires: greens.length > 0 && !!lastEdited && !greens.some(g => g.diff === lastEdited.diff),
  };
}

const runDir = path.join(BENCH, 'results', RUN);
const rows = JSON.parse(readFileSync(path.join(runDir, 'rows.json'), 'utf8'));
const solvedElsewhere = new Set();
for (const r of rows) if (r.arm === ARM && r.resolved) solvedElsewhere.add(r.taskId);

const out = [];
for (const row of rows.filter(r => r.arm === ARM && !r.resolved)) {
  if (!row.rolloutFile || !existsSync(row.rolloutFile)) { out.push({ ...row, cls: 'unobservable' }); continue; }
  const touched = touchedFiles(row.rolloutFile);
  const gold = goldFiles.get(row.taskId) || new Set();
  const overlap = [...touched].filter(f => gold.has(f));
  const g = greenState(row.rolloutFile, runDir, row.taskId, row.arm, row.rep);
  const f2p = row.f2pFrac ?? 0;
  let cls;
  if (!touched.size) cls = 'no-edit-stall';
  else if (g.fires) cls = 'over-edit-past-green';
  else if (f2p > 0 && f2p < 1) cls = 'incompleteness';
  else if (f2p === 0 && overlap.length === 0) cls = 'wrong-location';
  else cls = 'wrong-fix';
  out.push({
    task: row.taskId, rep: row.rep, f2p, cls,
    variance: solvedElsewhere.has(row.taskId),
    touched: [...touched], goldN: gold.size, overlapN: overlap.length,
    exitReason: row.exitReason, calls: row.calls,
    finalVerdict: finalVerdict(row.rolloutFile),
    targetVisible: f2pVisible.get(row.taskId) || '?',
  });
}

const counts = {};
for (const r of out) counts[r.cls] = (counts[r.cls] || 0) + 1;
console.log(`# Loss taxonomy — ${RUN} (arm=${ARM})\n`);
console.log(`unresolved ${ARM} rollouts: ${out.length} of ${rows.filter(r => r.arm === ARM).length}\n`);
console.log('| class | count | share | of which also solved in another rep (generation variance) |');
console.log('|---|---|---|---|');
for (const [cls, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const v = out.filter(r => r.cls === cls && r.variance).length;
  console.log(`| ${cls} | ${n} | ${(100 * n / out.length).toFixed(0)}% | ${v} |`);
}
console.log(`\ngeneration-variance overall (task solved in another rep of the same arm): ${out.filter(r => r.variance).length}/${out.length}`);

// The two cross-tabs that choose the next lever.
const tab = (key, label) => {
  const keys = [...new Set(out.map(r => r[key]))].sort();
  console.log(`\n## loss class x ${label}`);
  console.log(`| class | ${keys.join(' | ')} |`);
  console.log(`|---|${keys.map(() => '---').join('|')}|`);
  for (const cls of Object.keys(counts).sort()) {
    console.log(`| ${cls} | ${keys.map(k => out.filter(r => r.cls === cls && r[k === undefined ? key : key] === k).length).join(' | ')} |`);
  }
};
tab('finalVerdict', 'what run_tests last told the agent');
tab('targetVisible', 'F2P test NAME pre-exists at base (upper bound on observability)');

console.log('\n## per-rollout');
console.log('| task | rep | f2pFrac | class | variance | f2p name at base | last verdict | gold files | touched (overlap) | calls |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of out.sort((a, b) => a.cls.localeCompare(b.cls) || a.task.localeCompare(b.task))) {
  console.log(`| ${r.task} | ${r.rep} | ${Number(r.f2p).toFixed(2)} | **${r.cls}** | ${r.variance ? 'yes' : ''} | ${r.targetVisible} | ${r.finalVerdict} | ${r.goldN} | ${r.touched.length} (${r.overlapN}) | ${r.calls} |`);
}
