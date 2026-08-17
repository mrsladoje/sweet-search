#!/usr/bin/env node
// SLATE-B W0 gate — P4 falsifier 1: replay the frozen checker over every recorded patch.
//
// The checker was committed at 193ff9b before this file existed. Nothing here changes it;
// this only feeds it trees and records what it says.
//
// THREE QUESTIONS, and the third is the one P4's own arithmetic never asks.
//
//   1. Does it reject every recorded one-state patch?      (P4's pre-registered condition)
//   2. Does it accept the reference fix?                   (over-specification — the P3 trap)
//   3. What does it cost on work that already succeeded?   (rejection cost)
//
// Question 2 is where P4 can die exactly the way P3's Akinsho witness died. `ss-statecheck`
// is only useful if it runs before the agent finishes, so a checker that contradicts a
// correct patch converts solves into non-solves. If the reference fix carries only two of
// the four quadrants, the mirror rule over-specifies and must be withdrawn, whatever the
// rejection numbers look like.
//
// $0: `git archive` into a temp dir, `git apply`, static parse, delete. No build, no test
// run, no network. Golden checkouts are never written to.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze } from './w0-p4-statecheck.mjs';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const TASK = 'apple__swift-nio-http2-145';
const FILE = 'Sources/NIOHTTP2/StreamStateMachine.swift';
const RUNS = [
  ['codex', 'sb-codex-20260811'], ['opencode', 'sb-opencode-20260811'], ['claude-code', 'sb-claudecode-20260811'],
];

const spec = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'))
  .find(t => t.instance_id === TASK);
const goldDir = path.join(GOLDEN, `apple__swift-nio-http2@${spec.base_commit}`);

// Materialise the base tree read-only, apply a diff there, hand back the one file we read.
function fileAfter(patch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'w0p4-'));
  try {
    execFileSync('bash', ['-c', `git -C ${goldDir} archive HEAD | tar -x -C ${dir}`]);
    if (patch) {
      try {
        execFileSync('git', ['-C', dir, 'apply', '--whitespace=nowarn', '-'], { input: patch });
      } catch {
        try { execFileSync('git', ['-C', dir, 'apply', '-3', '--whitespace=nowarn', '-'], { input: patch }); }
        catch (e) { return { error: 'apply failed: ' + String(e.message).split('\n')[0] }; }
      }
    }
    const f = path.join(dir, FILE);
    if (!existsSync(f)) return { error: 'state machine file missing after apply' };
    return { text: readFileSync(f, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const baseText = fileAfter(null).text;

function score(label, patch, extra = {}) {
  const got = fileAfter(patch);
  if (got.error) return { label, verdict: 'ERROR', why: got.error, ...extra };
  const r = analyze(got.text, baseText);
  if (r.error) return { label, verdict: 'ERROR', why: r.error, ...extra };
  // Did the patch touch the operation pair at all? A patch that never widened either
  // operation is not evidence about the rule, and is reported separately rather than
  // being counted as a rejection the checker earned.
  const widened = r.allow.receivePushPromise.length > 2 || r.allow.sendPushPromise.length > 2;
  return {
    label, verdict: r.findings.length ? 'REJECT' : 'ACCEPT', widened,
    recvAllow: r.allow.receivePushPromise, sendAllow: r.allow.sendPushPromise,
    findings: r.findings.map(f => ({ rule: f.rule, op: f.op, state: f.state, why: f.why, path: f.path })),
    pairs: r.pairs, ...extra,
  };
}

const rows = [];
rows.push(score('BASE (unmodified)', null, { resolved: false }));

for (const [harness, run] of RUNS) {
  for (const arm of ['sweet', 'native']) {
    const meta = new Map();
    try {
      const rj = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
      for (const r of (Array.isArray(rj) ? rj : rj.rows)) if (r.taskId === TASK) meta.set(`${r.arm}|${r.rep}`, r);
    } catch { /* resolution is reported as unknown rather than guessed */ }
    for (const [rep, dir] of [[0, path.join(RESULTS, run, arm)], [1, path.join(RESULTS, run, arm, 'rep-1')]]) {
      const pf = path.join(dir, 'patches.json');
      if (!existsSync(pf)) continue;
      const rec = JSON.parse(readFileSync(pf, 'utf8')).find(p => p.instance_id === TASK);
      if (!rec) { rows.push({ label: `${harness} ${arm} r${rep}`, verdict: 'NO-PATCH' }); continue; }
      const m = meta.get(`${arm}|${rep}`);
      rows.push(score(`${harness} ${arm} r${rep}`, rec.patch,
        { harness, arm, rep, resolved: m ? !!m.resolved : null, f2p: m ? m.f2pFrac : null }));
    }
  }
}

// The reference fix goes LAST, so the checker's behaviour on the recorded patches is fixed
// before the gold tree is ever materialised.
rows.push(score('GOLD (reference fix)', spec.patch, { resolved: true }));

// ------------------------------------------------------------------------ report

const w = (s, n) => String(s).padEnd(n);
console.log(`task ${TASK}   base ${spec.base_commit}   file ${FILE}\n`);
console.log(w('cell', 26) + w('resolved', 10) + w('verdict', 9) + w('recv|send allow', 16) + 'counterexamples');
for (const r of rows) {
  const sizes = r.recvAllow ? `${r.recvAllow.length}|${r.sendAllow.length}` : '-';
  const ce = (r.findings || []).map(f => `${f.rule}:${f.state}`).join(' ') || (r.why || '');
  console.log(w(r.label, 26) + w(r.resolved === null ? '?' : r.resolved, 10) + w(r.verdict, 9) + w(sizes, 16) + ce);
}

const cells = rows.filter(r => r.harness);
const unresolved = cells.filter(r => r.resolved === false);
const resolved = cells.filter(r => r.resolved === true);
console.log('\n--- falsifier 1');
console.log(`recorded cells                       ${cells.length}`);
console.log(`  unresolved, REJECTed by the rule   ${unresolved.filter(r => r.verdict === 'REJECT').length}/${unresolved.length}`);
console.log(`  unresolved, ACCEPTed (rule missed) ${unresolved.filter(r => r.verdict === 'ACCEPT').length}`);
console.log(`  resolved, REJECTed (rejection cost)${' '.repeat(0)} ${resolved.filter(r => r.verdict === 'REJECT').length}/${resolved.length}`);
console.log(`  errors                             ${cells.filter(r => r.verdict === 'ERROR' || r.verdict === 'NO-PATCH').length}`);
const gold = rows[rows.length - 1];
console.log(`\ngold verdict                         ${gold.verdict}`
  + (gold.findings?.length ? '  <- OVER-SPECIFIED: ' + gold.findings.map(f => `${f.rule}:${f.state}`).join(' ') : ''));

const byRule = {};
for (const r of cells) for (const f of (r.findings || [])) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
console.log('counterexamples by rule              ' + JSON.stringify(byRule));

console.log('\n--- one full counterexample, as the tool would print it');
const sample = cells.find(r => r.findings?.length);
if (sample) {
  console.log(`(${sample.label})`);
  for (const f of sample.findings) {
    console.log(`\n[${f.rule}] ${f.op}\n  ${f.why}`);
    if (f.path?.length) console.log('  reachable by:\n' + f.path.map(s => '    ' + s).join('\n'));
  }
}

writeFileSync(process.env.OUT || '/root/w0-p4-replay.json', JSON.stringify(rows, null, 2));
