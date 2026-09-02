#!/usr/bin/env node
// F4 acceptance — replay the ANCHORED infra classifier over real suite output.
//
// Corpus: the per-task grader logs of the 12 fresh-pool runs. These hold the RAW suite
// output, which is what the shim classifies. The retained agent transcripts cannot serve:
// they keep only the CONDENSED form, in which the offending line is dropped and the shim's
// own "NETWORK UNAVAILABLE" banner is all that survives — an artefact of the bug itself.
//
// Reports, per task: how many logs the OLD bare `Could not resolve` alternative classified
// as infra, how many the anchored one does, and which lines drove each decision. The fix
// only NARROWS, so a log gaining an infra classification is a failure.
//
// Read-only. Usage: node f4-replay.mjs <results-root>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RES = process.argv[2];
const OLD = /(NETWORK UNAVAILABLE|no response from test broker|\[run_tests exit=|Could not resolve|Temporary failure in name resolution|Network is unreachable|Cannot connect to the Docker daemon|docker: Error)/;
const NEW = /(NETWORK UNAVAILABLE|no response from test broker|\[run_tests exit=|Could not resolve (host|hostname|proxy|dependency|dependencies|all dependencies|all files|all artifacts)|Temporary failure in name resolution|Network is unreachable|Cannot connect to the Docker daemon|docker: Error)/;
const RESOLVE_LINE = /Could not resolve.{0,80}/g;

const RUNS = [
  'fp-codex-tab-20260826', 'fp-codex-none-20260826', 'fp-codex-pipe-20260826',
  'fp-opencode-tab-20260826', 'fp-opencode-none-20260826', 'fp-opencode-pipe-20260826',
  'rp-oc-tab-20260827', 'rp-oc-none-20260827', 'rp-oc-pipe-20260827',
  'fp-claudecode-tab-20260826', 'fp-claudecode-none-20260826', 'fp-claudecode-pipe-20260826',
];

const byTask = new Map();
const resolveForms = new Map();
let logs = 0, runsSeen = new Set();
for (const run of RUNS) {
  for (const arm of ['native', 'sweet']) {
    const dir = path.join(RES, run, arm, 'logs');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('_log.txt')) continue;
      const task = f.replace(/_log\.txt$/, '');
      let text; try { text = readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      logs++; runsSeen.add(run);
      const oldInfra = OLD.test(text), newInfra = NEW.test(text);
      const a = byTask.get(task) || { n: 0, oldInfra: 0, newInfra: 0, flipped: 0 };
      a.n++; if (oldInfra) a.oldInfra++; if (newInfra) a.newInfra++;
      if (oldInfra && !newInfra) a.flipped++;
      byTask.set(task, a);
      for (const m of text.match(RESOLVE_LINE) || []) {
        const norm = m.replace(/\d+/g, 'N').trim();
        const r = resolveForms.get(norm) || { count: 0, tasks: new Set(), anchored: NEW.test(m) };
        r.count++; r.tasks.add(task); resolveForms.set(norm, r);
      }
    }
  }
}

console.log(`grader logs scanned: ${logs} across ${runsSeen.size} run(s), ${byTask.size} task(s)\n`);
console.log('task                                          logs  old-INFRA  new-INFRA  flipped');
let flipped = 0, gained = 0;
for (const [task, a] of [...byTask].sort((x, y) => y[1].flipped - x[1].flipped || x[0].localeCompare(y[0]))) {
  flipped += a.flipped;
  if (a.newInfra > a.oldInfra) gained += a.newInfra - a.oldInfra;
  if (a.oldInfra || a.newInfra) console.log(`${task.padEnd(44)} ${String(a.n).padStart(4)}  ${String(a.oldInfra).padStart(9)}  ${String(a.newInfra).padStart(9)}  ${String(a.flipped).padStart(7)}`);
}

console.log('\nevery distinct "Could not resolve" form in the corpus (digits normalised to N):');
for (const [form, r] of [...resolveForms].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${r.anchored ? 'INFRA    ' : 'not infra'}  x${String(r.count).padStart(4)}  ${[...r.tasks].join(', ')}\n              ${form}`);
}

console.log(`\nlogs reclassified OUT of INFRA: ${flipped}`);
console.log(`logs reclassified INTO INFRA (must be 0 — the fix only narrows): ${gained}`);

const acc = byTask.get('accenture__sfmc-devtools-1974');
if (!acc) { console.log('\nFAIL: no accenture grader log found'); process.exit(1); }
console.log(`\naccenture__sfmc-devtools-1974: ${acc.n} log(s); old INFRA ${acc.oldInfra}, new INFRA ${acc.newInfra}`);
const pass = acc.oldInfra > 0 && acc.newInfra === 0 && gained === 0;
console.log(pass
  ? '\nACCEPTANCE PASS — accenture no longer classifies INFRA and nothing became INFRA that was not already'
  : '\nACCEPTANCE FAIL — stop rule (uber §6 step 2): if accenture still classifies INFRA the cause is elsewhere. Stop and report; do not widen the fix.');
process.exit(pass ? 0 : 1);
