// Find DEV-RET (heldout-200) tasks that (a) are outside rotate20, (b) have a recorded rollout
// somewhere so the issue text is recoverable, and (c) have a golden base checkout on the box.
// BLINDED: reads only task IDs / repos / commits and directory listings. No labels, no gold.
import fs from 'node:fs';
const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
const RES = `${ROOT}/results`;
const GOLD = '/root/.ss-eval/golden';

const devret = fs.readFileSync(`${ROOT}/select/tasks_heldout.jsonl`, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
const rotate20 = new Set(JSON.parse(fs.readFileSync(`${ROOT}/select/tasks_luna_rotate20.json`, 'utf8'))
  .map(t => t.instance_id));

const byId = new Map(devret.map(t => [t.instance_id, t]));
const goldens = new Set(fs.readdirSync(GOLD));

// which DEV-RET tasks have any recorded agent-state anywhere
const seen = new Map(); // taskId -> [runDir...]
for (const run of fs.readdirSync(RES)) {
  const as = `${RES}/${run}/agent-state`;
  if (!fs.existsSync(as)) continue;
  for (const d of fs.readdirSync(as)) {
    const m = d.replace(/-(native|sweet)$/, '');
    if (!byId.has(m) || rotate20.has(m)) continue;
    if (!seen.has(m)) seen.set(m, []);
    seen.get(m).push(run);
  }
}

const rows = [];
for (const [id, runs] of seen) {
  const t = byId.get(id);
  const key = `${t.repo.replace('/', '__')}@${t.base_commit}`;
  rows.push({
    id, lang: t.language, repo: t.repo, base: t.base_commit,
    f2p: t.n_fail_to_pass, p2p: t.n_pass_to_pass,
    golden: goldens.has(key) ? key : null,
    runs: runs.length, sample: runs[0],
  });
}
rows.sort((a, b) => (b.golden ? 1 : 0) - (a.golden ? 1 : 0) || a.id.localeCompare(b.id));
console.log(JSON.stringify(rows, null, 1));
console.log('TOTAL_DEVRET=' + devret.length, 'CANDIDATES=' + rows.length,
  'WITH_GOLDEN=' + rows.filter(r => r.golden).length);
