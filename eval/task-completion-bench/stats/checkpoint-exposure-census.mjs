#!/usr/bin/env node
/**
 * $0 exposure census for verified checkpoint-on-green (EDIT_THRASHING.md §4).
 *
 * Answers, without a single model call, whether the failure shape a checkpoint
 * selector targets actually occurs: the agent reaches a suite-green state, edits past
 * it, and submits a state that is no longer green.
 *
 * Two ledgers already retained by every rollout make this reconstructable:
 *   - the raw agent rollout, which carries the harness's OWN footer lines
 *       [run_tests verdict] status=… scope=… exit=…
 *       [run_tests baseline-diff] verdict=… introduced_failures=N … trustworthy=yes|no
 *     so "green" is exactly what the agent was told, never a re-derivation; and
 *   - rt-dedup/<task>-<arm>.jsonl, which carries diffSha + diffBytes per call, giving
 *     the source state each verdict belongs to.
 * They are joined by call order. A length mismatch is REPORTED, never imputed — some
 * long suites lose tool output before it reaches the retained session.
 *
 * A VERIFIED checkpoint is §4.1 plus handoff guardrail 1: canonical full scope, a
 * trustworthy baseline, zero introduced failures, verdict PASS, on a real source edit.
 *
 * Usage: node stats/checkpoint-exposure-census.mjs <results/run-dir>
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HO2_RE = /tasks_heldout2|heldout2(?:[_.\/-]|$)|(?:^|[_.\/-])ho2(?:[_.\/-]|$)/i;
// sha256 of the empty string — the diffSha recorded for a clean, unedited tree.
const EMPTY_DIFF = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Per-rep call ledgers from the rt-dedup log (one file holds every rep, session-delimited). */
function dedupByRep(runDir, task, arm) {
  const file = path.join(runDir, 'rt-dedup', `${task}-${arm}.jsonl`);
  const out = new Map();
  if (!existsSync(file)) return out;
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.kind === 'session') {
      cur = [];
      out.set(/__r(\d+)__/.exec(row.rundir || '')?.[1] ?? String(out.size), cur);
      continue;
    }
    if (cur) cur.push(row);
  }
  return out;
}

/** Ordered run_tests footers from one raw rollout. */
export function rolloutFooters(file) {
  const seq = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    const payload = event.payload;
    if (!payload) continue;
    if (payload.type !== 'custom_tool_call_output' && payload.type !== 'function_call_output') continue;
    const text = Array.isArray(payload.output) ? payload.output.map(part => part?.text || '').join('')
      : (typeof payload.output === 'string' ? payload.output : '');
    const verdictLine = /\[run_tests verdict\] status=(\w+) scope=(\w+) exit=(-?\d+)/.exec(text);
    const baselineLine = /\[run_tests baseline-diff\] verdict=(\w+) introduced_failures=(\d+) pre_existing_failures=(\d+) trustworthy=(\w+)/.exec(text);
    if (!verdictLine && !baselineLine) continue;
    seq.push({
      status: verdictLine?.[1] ?? null, scope: verdictLine?.[2] ?? null,
      exit: verdictLine ? Number(verdictLine[3]) : null,
      verdict: baselineLine?.[1] ?? null,
      introduced: baselineLine ? Number(baselineLine[2]) : null,
      preExisting: baselineLine ? Number(baselineLine[3]) : null,
      trustworthy: baselineLine?.[4] === 'yes',
      dedup: /\[run_tests-dedup\]/.test(text),
    });
  }
  return seq;
}

export function isVerifiedGreen(footer, record) {
  return footer.scope === 'full' && footer.trustworthy === true && footer.introduced === 0
    && footer.verdict === 'PASS' && record.diffBytes > 0 && record.diffSha !== EMPTY_DIFF;
}

export function censusRun(runDir) {
  const rows = JSON.parse(readFileSync(path.join(runDir, 'rows.json'), 'utf8'));
  const report = [];
  for (const row of rows) {
    if (!row.rolloutFile || !existsSync(row.rolloutFile)) {
      report.push({ task: row.taskId, arm: row.arm, rep: row.rep, missing: true });
      continue;
    }
    const footers = rolloutFooters(row.rolloutFile);
    const records = dedupByRep(runDir, row.taskId, row.arm).get(String(row.rep)) || [];
    const paired = Math.min(footers.length, records.length);
    const calls = [];
    for (let i = 0; i < paired; i++) {
      calls.push({
        index: i + 1, ...footers[i], diff: records[i].diffSha, bytes: records[i].diffBytes,
        argv: (records[i].argv || []).join(' '),
        green: isVerifiedGreen(footers[i], records[i]),
      });
    }
    // Collapse to distinct source states in observation order.
    const states = [];
    for (const call of calls) {
      const last = states.at(-1);
      if (last && last.diff === call.diff) { last.calls.push(call); continue; }
      states.push({ diff: call.diff, bytes: call.bytes, calls: [call] });
    }
    for (const state of states) state.green = state.calls.some(call => call.green);
    const edited = states.filter(s => s.bytes > 0 && s.diff !== EMPTY_DIFF);
    const greens = edited.filter(s => s.green);
    const lastEdited = edited.at(-1) || null;
    report.push({
      task: row.taskId, arm: row.arm, rep: row.rep, resolved: !!row.resolved, f2pFrac: row.f2pFrac,
      footerCalls: footers.length, dedupCalls: records.length,
      joinOk: footers.length === records.length,
      editedStates: edited.length, greenStates: greens.length,
      anyTrustworthy: calls.some(c => c.trustworthy),
      anyVerifiedGreen: greens.length > 0,
      finalEditedGreen: lastEdited ? lastEdited.green : null,
      // The trigger: a verified-green state exists AND the last edited state is a
      // different, non-green state.
      fires: greens.length > 0 && !!lastEdited && !greens.some(g => g.diff === lastEdited.diff),
      verdictShapes: [...new Set(calls.map(c => `${c.status}/${c.verdict}${c.trustworthy ? '+T' : '-T'}`))],
      seq: calls.map(c => `${c.index}${c.argv ? '*' : ''}:${(c.diff || '??').slice(0, 6)}/${c.bytes}b/${c.status}-${c.verdict}${c.trustworthy ? 'T' : 't'}/i${c.introduced}`),
    });
  }
  return report;
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('usage: checkpoint-exposure-census.mjs <results/run-dir>');
    process.exit(2);
  }
  if (HO2_RE.test(runDir)) throw new Error('refusing forbidden HO2 path');
  const report = censusRun(runDir);
  const ok = report.filter(r => !r.missing);
  const n = ok.length;
  const share = (count, total = n) => `${count}/${total} (${total ? (100 * count / total).toFixed(0) : 0}%)`;
  const clean = ok.filter(r => r.joinOk);
  const fires = ok.filter(r => r.fires);

  console.log(`# Verified-checkpoint exposure census — ${runDir}\n`);
  console.log(`rollouts=${n}  cleanly-joined=${clean.length}  join-mismatch=${n - clean.length}  resolved=${ok.filter(r => r.resolved).length}`);
  console.log(`\n## Can a verified checkpoint exist at all?`);
  console.log(`  any trustworthy baseline:        ${share(ok.filter(r => r.anyTrustworthy).length)}`);
  console.log(`  any verified-green edited state: ${share(ok.filter(r => r.anyVerifiedGreen).length)}`);
  console.log(`  >=2 distinct edited states:      ${share(ok.filter(r => r.editedStates >= 2).length)}`);
  console.log(`\n## Trigger — verified-green state exists AND final edited state is a different, non-green state`);
  console.log(`  TRIGGERS: ${share(fires.length)}   (of those: unresolved=${fires.filter(r => !r.resolved).length} resolved=${fires.filter(r => r.resolved).length})`);
  if (!fires.length && clean.length) {
    const bound = 1 - Math.pow(0.05, 1 / clean.length);
    console.log(`  zero triggers in ${clean.length} cleanly-joined rollouts -> one-sided 95% upper bound on trigger rate ${(100 * bound).toFixed(1)}%`);
    console.log(`  EDIT_THRASHING 4.2 needs >=59 exposures -> ~${Math.ceil(59 / bound)} rollouts before the safety gate is even evaluable`);
  }

  console.log(`\n## Verdict shapes the agent was actually shown, per task`);
  const byTask = new Map();
  for (const r of ok) {
    const e = byTask.get(r.task) || { rollouts: 0, trustworthy: 0, green: 0, shapes: new Set() };
    e.rollouts++;
    if (r.anyTrustworthy) e.trustworthy++;
    if (r.anyVerifiedGreen) e.green++;
    for (const s of r.verdictShapes) e.shapes.add(s);
    byTask.set(r.task, e);
  }
  console.log('| task | rollouts | any trustworthy baseline | any verified-green | status/verdict shapes |');
  console.log('|---|---|---|---|---|');
  for (const [task, e] of [...byTask].sort()) {
    console.log(`| ${task} | ${e.rollouts} | ${e.trustworthy} | ${e.green} | ${[...e.shapes].join(', ')} |`);
  }

  const multi = ok.filter(r => r.editedStates >= 2);
  if (multi.length) {
    console.log(`\n## Rollouts with >=2 edited states (where a selector could act)`);
    console.log('| task | arm | rep | resolved | edited states | verified-green states | final green | fires |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of multi) {
      console.log(`| ${r.task} | ${r.arm} | ${r.rep} | ${r.resolved} | ${r.editedStates} | ${r.greenStates} | ${r.finalEditedGreen} | ${r.fires ? '**YES**' : 'no'} |`);
    }
  }
  for (const r of fires) console.log(`\ntriggering sequence ${r.task}/${r.arm}/r${r.rep} resolved=${r.resolved}\n  ${r.seq.join('  ')}`);

  const mismatched = ok.filter(r => !r.joinOk);
  if (mismatched.length) {
    console.log(`\n## Join mismatches — reported, not imputed (analysis truncated to the shorter sequence)`);
    for (const r of mismatched) console.log(`  ${r.task}/${r.arm}/r${r.rep}: footers=${r.footerCalls} dedup=${r.dedupCalls}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
