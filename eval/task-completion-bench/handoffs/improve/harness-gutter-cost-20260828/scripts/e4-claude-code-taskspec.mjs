// e4-claude-code-taskspec.mjs — dump the spec (problem, gold patch, F2P) for the tasks under forensics.
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json', 'utf8'));
const arr = Array.isArray(T) ? T : (T.tasks || Object.values(T));
const want = process.argv.slice(2);
const MAXPS = Number(process.env.MAXPS || 1400);
const MAXP = Number(process.env.MAXP || 4000);
for (const id of want) {
  const t = arr.find(x => x.instance_id === id);
  if (!t) { console.log(`### ${id}: NOT FOUND`); continue; }
  console.log('='.repeat(100));
  console.log(`### ${id}  repo=${t.repo} lang=${t.language} base=${String(t.base_commit).slice(0, 10)}`);
  const f2p = typeof t.FAIL_TO_PASS === 'string' ? JSON.parse(t.FAIL_TO_PASS) : t.FAIL_TO_PASS;
  const p2p = typeof t.PASS_TO_PASS === 'string' ? JSON.parse(t.PASS_TO_PASS) : t.PASS_TO_PASS;
  console.log(`FAIL_TO_PASS (${(f2p || []).length}): ${JSON.stringify(f2p)}`);
  console.log(`PASS_TO_PASS count: ${(p2p || []).length}`);
  console.log('--- problem_statement ---');
  console.log(String(t.problem_statement).slice(0, MAXPS));
  console.log('--- gold patch (files) ---');
  console.log([...String(t.patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]).join('\n'));
  console.log('--- gold patch ---');
  console.log(String(t.patch).slice(0, MAXP));
  console.log('--- test_patch files ---');
  console.log([...String(t.test_patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]).join('\n'));
}
