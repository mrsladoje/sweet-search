#!/usr/bin/env node
// SLATE-B W0 gate — P1 dependency closure: the BLIND-SPOT TRIGGER CENSUS.
//
// P1 proposes ss-deps: index the pinned installed dependency source so the agent can
// read the contract it is currently guessing. Its kill condition is two-part —
// "source/behavior cannot adjudicate contracts OR the model has no demonstrated intent
// to consult it". This script measures the second half, and the frequency that decides
// whether ss-deps is a general capability or a one-task fix.
//
// Two signal classes, deliberately kept apart because they mean different things:
//
//   REACHED  — the rollout actually TRIED to read dependency source (imported the
//              private module, went looking in site-packages/node_modules, ran pip
//              show, fetched the upstream). This is demonstrated intent, and it is the
//              strong signal: the model did not merely wonder, it acted and was stopped.
//
//   STATED   — the rollout said in words that an external/installed contract was
//              unresolved. Weaker: phrasing varies and this is where over-fitting to
//              pytask's wording would creep in, so the patterns below avoid pytest
//              vocabulary entirely and are reported per-task so a single task cannot
//              masquerade as a trend.
//
// Counting is PER ROLLOUT, not per line: one rollout that greps site-packages six times
// is one rollout with intent, not six. Inflating that count is how a one-task feature
// starts looking general.
//
// $0: reads recorded rollout files only.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const RESULTS = process.env.RESULTS
  || '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];

// Acting on a dependency-source need. Language-agnostic on purpose: python, node, ruby,
// java, rust and go each get a way of saying "show me the installed library".
const REACHED = [
  /site-packages/i,
  /\bnode_modules\b/,
  /\bpip\s+(?:show|download)\b/i,
  /\bimport\s+_[a-z_]+\b/,                    // importing a private impl module
  /\bnpm\s+(?:ls|explore|view)\b/i,
  /\bgem\s+(?:contents|which)\b/i,
  /\bcargo\s+(?:vendor|expand)\b/i,
  /\bgo\s+mod\s+(?:vendor|download)\b/i,
  /~\/\.cargo\/registry|\$GOPATH\/pkg\/mod|~\/\.m2\/repository/,
  /\bWebFetch\b|\braw\.githubusercontent\.com\b/,
  /\bfind\s+\/\s+-name\b/,
];

// Saying a dependency/external contract is unresolved. No pytest words.
const STATED = [
  /blind ?spot/i,
  /\b(?:exact|precise)\s+(?:contract|signature|interface|api)\b/i,
  /\bdon['’]t know (?:the )?(?:exact|what)\b[^.]{0,60}\b(?:signature|contract|argument|param)/i,
  /\b(?:library|framework|upstream|installed|third[- ]party|dependency)\b[^.]{0,80}\b(?:expects?|contract|signature|passes?)\b/i,
  /\bcannot (?:read|inspect|see|access)\b[^.]{0,60}\b(?:source|implementation|library|package)\b/i,
];

const rolloutFiles = (runDir) => {
  const out = [];
  const agentState = path.join(runDir, 'agent-state');
  if (!existsSync(agentState)) return out;
  for (const cell of readdirSync(agentState)) {
    const base = path.join(agentState, cell);
    const walk = (d, depth = 0) => {
      if (depth > 7) return;
      let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        // main rollouts only; subagent sidechains are a different question
        if (/rollout-.*\.jsonl$|attempt-1\.stdout\.ndjson$/.test(e.name)) out.push({ cell, p });
        else if (/^[0-9a-f-]{36}\.jsonl$/.test(e.name) && !d.includes('subagents')) out.push({ cell, p });
      }
    };
    walk(base);
  }
  return out;
};

const cellParts = (cell) => {
  const m = cell.match(/^(.*)-(native|sweet)$/);
  return m ? { task: m[1], arm: m[2] } : { task: cell, arm: '?' };
};

const perRun = [];
for (const run of RUNS) {
  const dir = path.join(RESULTS, run);
  const files = rolloutFiles(dir);
  const rollouts = new Map();   // file -> {task, arm, reached:Set, stated:Set}
  for (const { cell, p } of files) {
    let text = '';
    try { if (statSync(p).size > 120e6) continue; text = readFileSync(p, 'utf8'); } catch { continue; }
    const { task, arm } = cellParts(cell);
    const reached = new Set(), stated = new Set();
    for (const re of REACHED) if (re.test(text)) reached.add(re.source);
    for (const re of STATED) if (re.test(text)) stated.add(re.source);
    rollouts.set(p, { task, arm, reached, stated });
  }
  perRun.push({ run, rollouts });
}

console.log('P1 blind-spot trigger census — per ROLLOUT, main sessions only\n');
const taskTotals = new Map();
for (const { run, rollouts } of perRun) {
  const byArm = { native: { n: 0, reached: 0, stated: 0 }, sweet: { n: 0, reached: 0, stated: 0 } };
  for (const [, r] of rollouts) {
    const b = byArm[r.arm]; if (!b) continue;
    b.n++;
    if (r.reached.size) b.reached++;
    if (r.stated.size) b.stated++;
    if (r.reached.size || r.stated.size) {
      const k = r.task;
      if (!taskTotals.has(k)) taskTotals.set(k, { reached: 0, stated: 0 });
      if (r.reached.size) taskTotals.get(k).reached++;
      if (r.stated.size) taskTotals.get(k).stated++;
    }
  }
  console.log(`=== ${run} (${rollouts.size} rollouts) ===`);
  for (const arm of ['native', 'sweet']) {
    const b = byArm[arm];
    console.log(`  ${arm.padEnd(7)} n=${String(b.n).padStart(2)}  REACHED ${b.reached}  STATED ${b.stated}`);
  }
  console.log('');
}

console.log('=== tasks that triggered at all (the number that decides generality) ===');
const sorted = [...taskTotals.entries()].sort((a, b) => (b[1].reached + b[1].stated) - (a[1].reached + a[1].stated));
for (const [task, c] of sorted) console.log(`  ${task.padEnd(40)} REACHED ${c.reached}  STATED ${c.stated}`);
console.log(`\ndistinct tasks with any dependency-shaped signal: ${sorted.length}`);
console.log(`distinct tasks where a rollout actually REACHED for source: ${sorted.filter(([, c]) => c.reached).length}`);
