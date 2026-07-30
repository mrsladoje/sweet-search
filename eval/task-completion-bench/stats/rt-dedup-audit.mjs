#!/usr/bin/env node
// Audit the L3 run_tests dedup lever for one run: every suppression is re-checked
// MECHANICALLY against the call it cited, from the logged key components, and the
// per-rollout firing table is printed for the hand audit.
//
// A suppression is a FALSE POSITIVE unless, versus the cited call, all of:
//   diffSha identical · untracked (path, contentSha) list identical · argv identical
//   · result digest identical.
// Those four are exactly what the state key + result digest are built from, so a
// mismatch here means the key logic is broken, not merely that the agent got lucky.
//
// Usage: RUN_ID=<run> node stats/rt-dedup-audit.mjs [--rows results/<run>/rows.json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.env.RUN_ID;
if (!runId) { console.error('RUN_ID=<run> required'); process.exit(2); }
const dir = path.join(BENCH, 'results', runId, 'rt-dedup');
if (!existsSync(dir)) { console.error(`no dedup logs at ${dir}`); process.exit(2); }

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
let totalCalls = 0, totalSup = 0, totalChanged = 0, totalNoKey = 0, falsePos = 0, bytesSaved = 0;

for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
  const recs = readFileSync(path.join(dir, file), 'utf8').split('\n')
    .filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  // Only the LAST session's records are live state (see rt-dedup.mjs).
  let start = 0;
  recs.forEach((r, i) => { if (r.kind === 'session') start = i + 1; });
  const sessions = recs.filter(r => r.kind === 'session').length;
  const calls = recs.slice(start).filter(r => r.kind !== 'session');
  const byCall = new Map(calls.map(r => [r.call, r]));
  const sup = calls.filter(r => r.suppressed);
  const changed = calls.filter(r => r.decision === 'changed');
  const nokey = calls.filter(r => r.decision === 'no-key');
  totalCalls += calls.length; totalSup += sup.length;
  totalChanged += changed.length; totalNoKey += nokey.length;

  console.log(`\n=== ${file.replace(/\.jsonl$/, '')} — ${calls.length} run_tests call(s), ` +
    `${sup.length} suppressed, ${changed.length} changed-under-same-key, ${nokey.length} no-key` +
    (sessions > 1 ? `, ${sessions} sessions (re-run; earlier attempt retained)` : ''));
  for (const r of calls) {
    const tag = r.suppressed ? 'SUPPRESSED' : r.decision.toUpperCase();
    console.log(`  #${String(r.call).padStart(3)} ${tag.padEnd(11)} ` +
      `key=${(r.key || '-').slice(0, 12)} digest=${(r.digest || '-').slice(0, 8)} ` +
      `diff=${(r.diffSha || '-').slice(0, 8)}/${r.diffBytes ?? '-'}B untracked=${(r.untracked || []).length} ` +
      `argv=${JSON.stringify(r.argv || [])} exit=${r.exit ?? '-'} fails=${r.failures ?? '-'}` +
      (r.citeCall ? ` cites=#${r.citeCall}` : '') + (r.infra ? ' INFRA' : '') +
      (r.reason ? ` (${r.reason})` : ''));
  }
  for (const r of sup) {
    const cited = byCall.get(r.citeCall);
    const problems = [];
    if (!cited) problems.push('cited call not in this session');
    else {
      if (cited.key !== r.key) problems.push(`key mismatch (${cited.key} vs ${r.key})`);
      if (cited.diffSha !== r.diffSha) problems.push('diffSha mismatch');
      if (!eq(cited.untracked, r.untracked)) problems.push('untracked set mismatch');
      if (!eq(cited.argv, r.argv)) problems.push('argv mismatch');
      if (cited.digest !== r.digest) problems.push('result digest mismatch');
      if (r.infra) problems.push('suppressed an infra-error result');
    }
    if (problems.length) {
      falsePos++;
      console.log(`  !! FALSE POSITIVE at #${r.call}: ${problems.join('; ')}`);
    } else {
      // How much resident context the suppression avoided: the transcript this key
      // produced when it was NOT suppressed, minus the summary.
      const full = byCall.get(r.citeCall)?.outBytes || 0;
      bytesSaved += Math.max(0, full - 300);
    }
  }
}

console.log(`\n--- run ${runId}: ${totalCalls} run_tests calls | ${totalSup} suppressed | ` +
  `${totalChanged} changed-under-identical-key | ${totalNoKey} abstained (no key) | ` +
  `FALSE POSITIVES: ${falsePos} | ~${Math.round(bytesSaved / 1024)} KiB of transcript not re-sent`);
process.exit(falsePos ? 1 : 0);
