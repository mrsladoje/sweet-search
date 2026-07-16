#!/usr/bin/env node
// env-ledger-summarize.mjs — collapse a sweep's ledger.jsonl (append-only; retries
// append, LAST verdict per task wins) into env-ledger.json + a summary table.
// Usage: node env-ledger-summarize.mjs --in <dir-with-ledger.jsonl> [--out env-ledger.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const IN = arg('in');
const OUT = arg('out', path.join(IN, 'env-ledger.json'));

const last = new Map();
for (const l of readFileSync(path.join(IN, 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean)) {
  try { const r = JSON.parse(l); last.set(r.instance_id, r); } catch { /* */ }
}
const rows = [...last.values()];
const by = (k) => rows.reduce((m, r) => ((m[r[k] ?? '?'] = (m[r[k] ?? '?'] || 0) + 1), m), {});
const statuses = by('status');

const summary = {
  _meta: {
    generated: new Date().toISOString(),
    method: 'official gold patch graded via eval.py --golden-eval under --network none, task-overrides applied (same mutation as run-pilot loadTasks). Arms-blind: no agent code involved.',
    statuses: {
      'gold-valid': 'gold grades FULL offline — environment honest',
      'needs-warming': 'gold fails with a network signature — prep-phase dependency warming candidate (prep-warm.mjs)',
      'env-broken-nonnet': 'gold fails with NO network signature — curation/test defect; unfixable-candidate until diagnosed',
      'infra': 'grading machinery failure (image/report/timeout) — re-sweep',
    },
  },
  counts: statuses,
  byLanguage: {},
  tasks: {},
};
for (const r of rows.sort((a, b) => a.instance_id.localeCompare(b.instance_id))) {
  summary.tasks[r.instance_id] = {
    status: r.status, grade: r.grade ?? null, language: r.language,
    f2p: r.f2pTot != null ? `${r.f2pPass}/${r.f2pTot}` : null, p2pFails: r.p2pFails ?? null,
    image: r.image, overridden: !!r.overridden, evidence: r.evidence || r.signature || '',
  };
  const lang = r.language || '?';
  (summary.byLanguage[lang] ||= { total: 0 })[r.status] = ((summary.byLanguage[lang] ||= {})[r.status] || 0) + 1;
  summary.byLanguage[lang].total++;
}
writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');

// console table
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(`\n${rows.length} tasks — ${Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`);
console.log(pad('language', 10), pad('total', 6), pad('gold-valid', 11), pad('needs-warm', 11), pad('nonnet', 7), pad('infra', 6));
for (const [lang, c] of Object.entries(summary.byLanguage).sort()) {
  console.log(pad(lang, 10), pad(c.total, 6), pad(c['gold-valid'] || 0, 11), pad(c['needs-warming'] || 0, 11), pad(c['env-broken-nonnet'] || 0, 7), pad(c['infra'] || 0, 6));
}
console.log(`\nnon-valid detail:`);
for (const r of rows.filter(r => r.status !== 'gold-valid').sort((a, b) => (a.status + a.instance_id).localeCompare(b.status + b.instance_id))) {
  console.log(` ${pad(r.status, 18)} ${pad(r.instance_id, 44)} ${String(r.evidence || r.signature || '').slice(0, 90)}`);
}
console.log(`\nwritten: ${OUT}`);
