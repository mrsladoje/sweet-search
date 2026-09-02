// e4-claude-code-cellcard.mjs — one forensic card per (task, arm/form, rep):
// grader verdict, model_patch, tool-call storyline, ss-* health, edit failures.
// usage: node cellcard.mjs <task> [--forms TAB,NONE,PIPE,native] [--full-patch] [--storyline]
import fs from 'node:fs';
import path from 'node:path';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const argv = process.argv.slice(2);
const task = argv[0];
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.includes('--' + n);
const forms = flag('forms', 'native,TAB,NONE,PIPE').split(',');
const PATCHMAX = Number(flag('patch-max', has('full-patch') ? 1e9 : 2200));

const repDir = (runId, arm, rep) => rep === 0 ? `${BASE}/${runId}/${arm}` : `${BASE}/${runId}/${arm}/rep-${rep}`;
function grader(runId, arm, rep) {
  const d = repDir(runId, arm, rep);
  try {
    const r = JSON.parse(fs.readFileSync(path.join(d, 'report.json'), 'utf8'));
    return (r.items || []).find(x => x.instance_id === task) || null;
  } catch { return null; }
}
function patchOf(runId, arm, rep) {
  const d = repDir(runId, arm, rep);
  try {
    const p = JSON.parse(fs.readFileSync(path.join(d, 'patches.json'), 'utf8'));
    const hit = Object.values(p).find(x => x.instance_id === task);
    return hit ? String(hit.patch || '') : null;
  } catch { return null; }
}
function logOf(runId, arm, rep) {
  const d = repDir(runId, arm, rep);
  try { return fs.readFileSync(path.join(d, 'logs', `${task}_log.txt`), 'utf8'); } catch { return null; }
}
const rowFor = (runId, arm, rep) => {
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8'));
  return rows.find(r => r.taskId === task && r.arm === arm && r.rep === rep) || null;
};
for (const form of forms) {
  const runId = form === 'native' ? P.RUNS.TAB : P.RUNS[form];
  const arm = form === 'native' ? 'native' : 'sweet';
  for (const rep of [0, 1, 2]) {
    const row = rowFor(runId, arm, rep);
    const g = grader(runId, arm, rep);
    console.log('='.repeat(100));
    console.log(`## ${task} | ${form} | rep${rep} | resolved=${row?.resolved} f2p=${row?.f2pFrac} calls=${row?.calls} ss=${row?.ss} edits=${row?.toolCounts?.edit} hunks=${row?.patchHunks} files=${row?.patchFiles} exit=${row?.exitReason} rt=${row?.rtLaunched}/${row?.rtVerdicts} sidechain=${row?.sidechainCount} wall=${Math.round((row?.wallMs || 0) / 1000)}s`);
    if (g) console.log(`   grader: passed_match=${g.passed_match} from_fail_to_pass=${JSON.stringify(g.from_fail_to_pass)} failed_p2p=${JSON.stringify(g.failed_from_pass_to_pass)} exit=${g.exit_code} n=${g.n_test_results} err=${JSON.stringify(String(g.error || '').slice(0, 200))}`);
    const pt = patchOf(runId, arm, rep);
    console.log(`   patch files: ${pt ? [...pt.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]).join(', ') : '(none)'}`);
    if (has('patch')) console.log((pt || '(EMPTY PATCH)').slice(0, PATCHMAX));
    if (has('storyline')) {
      const ts = P.transcriptsOf(runId, task, arm).filter(t => t.rep === rep);
      for (const t of ts) {
        let all = P.parseTranscript(t.file).calls.slice();
        for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
        all.forEach((c, i) => {
          const cmd = c.name === 'Bash' ? String(c.input.command || '') : `${JSON.stringify(c.input).slice(0, 160)}`;
          const res = String(c.result || '');
          const badge = /String to replace not found/.test(res) ? ' [EDIT-NOTFOUND]'
            : /Found \d+ matches of the string/.test(res) ? ' [EDIT-AMBIGUOUS]'
            : /No changes to make/.test(res) ? ' [EDIT-NOOP]'
            : /InputValidationError/.test(res) ? ' [EDIT-JSON-ERR]'
            : /\(no matches\)/.test(res) ? ' [SS-EMPTY]'
            : /\[ss-\*\] crash/.test(res) ? ' [SS-CRASH]'
            : /^Exit code 2/.test(res) ? ' [SS-USAGE]'
            : /\[ss-read\] error/.test(res) ? ' [SS-READ-ENOENT]' : '';
          console.log(`   ${String(i).padStart(3)} ${c.name.padEnd(10)} ${cmd.replace(/\s+/g, ' ').slice(0, 150)}${badge}`);
        });
      }
    }
    if (has('log')) { const l = logOf(runId, arm, rep); console.log('--- grader log tail ---'); console.log((l || '').slice(-Number(flag('log-tail', 1800)))); }
  }
}
