#!/usr/bin/env node
// W0 gate — P7 forge addressability census. Executes W0-P7-PREREGISTRATION.md.
//
// One question: how many paid dollars sit AFTER the point where the forge proposes to
// take over? Everything else in this file is bookkeeping in service of that ratio.
//
// The checkpoint is the API turn containing the first file-mutating call, and that turn is
// charged to BEFORE — the forge cannot avoid paying for the turn in which the model commits
// to an edit. That choice is conservative against P7 by construction.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', 'claude-code': 'sb-claudecode-20260811' };
const EXCLUDE_TASK = 'dotnet__yarp-2825';            // D1: ungradeable, closed by removal
const DEGEN_INPUT_BYTES = 50_000;                    // F5 detector as pre-registered (finds nothing; kept for the record)
const OUTPUT_CAP_FLAG = 16_000;                      // F5 re-derived: half the observed 32,000 cap
const ROLE_TAG = /<\|(?:im_start|im_end|assistant|user|system)\|>/;

const jl = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const walk = (d, out = []) => { let e = []; try { e = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); } return out; };

// ── what counts as a file mutation ────────────────────────────────────────────────────
// Shell writes are matched conservatively: a redirect / sed -i / tee / apply_patch aimed at
// a path. A bare `>` comparison would be a false positive, so the redirect pattern requires
// a following path-looking token containing a slash.
// Tool names are the ones the runs actually emit, enumerated from the traces rather than
// assumed: opencode's editor is `apply_patch` (NOT `edit`/`write`), and codex packs every
// operation into a single `exec`, so only the envelope inside the payload identifies a write.
const EDIT_TOOLS = {
  opencode: new Set(['apply_patch', 'edit', 'write', 'multiedit']),
  'claude-code': new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']),
  codex: new Set(),
};
const PATCH_ENVELOPE = /\*\*\*\s*Begin Patch/;
const SHELL_WRITE = [
  /\bsed\s+(-[a-zA-Z]*\s+)*-i\b/,
  /\btee\s+(-a\s+)?[\w./-]+/,
  /\bpatch\s+(-\w+\s+)*<\s*/,
  /\bcat\s*<<\s*['"]?EOF['"]?\s*>/,
];
// A redirect only counts when its target is a real path that is not scratch. `> /tmp/x` and
// `> /dev/null` are how agents stash output; charging those as edits would move the
// checkpoint earlier and inflate the addressable share.
const REDIRECT = /(^|[^->\d\s])>>?\s*['"]?((?:[\w.@+-]+\/)+[\w.@+-]+)/g;
const SCRATCH = /^\/(?:tmp|dev|proc|sys|var\/tmp)\b/;
function shellWrites(cmd) {
  const c = cmd || '';
  if (!c) return false;
  if (SHELL_WRITE.some(r => r.test(c))) return true;
  REDIRECT.lastIndex = 0;
  let m; while ((m = REDIRECT.exec(c))) { const t = m[2]; if (!SCRATCH.test(t.startsWith('/') ? t : '/' + t) && !/^\/tmp/.test(t)) return true; }
  return false;
}
// A call mutates the checkout if its tool is an editor, its payload carries a patch
// envelope, or it is a shell command that writes.
function mutates(harness, c) {
  if (EDIT_TOOLS[harness].has(c.name)) return true;
  if (PATCH_ENVELOPE.test(c.raw || '') || PATCH_ENVELOPE.test(c.text || '')) return true;
  return shellWrites(c.cmd || '') || (harness === 'codex' && shellWrites(c.text || ''));
}

// ── per-harness trace normalisation ───────────────────────────────────────────────────
// Returns { turnCount, calls: [{turn, name, text, isError, inputBytes}] } where `turn` is
// 1-based and indexes the SAME sequence the cost ledger recorded.
function parseCodex(file) {
  const calls = []; const usage = []; let turn = 1; let turnCount = 0;
  for (const o of jl(file)) {
    const p = o.payload || {}, t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      usage.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
        out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) });   // ideal-cost.mjs turnsFromRollout
      turn++; turnCount++; continue;
    }
    if (t === 'custom_tool_call') {
      const raw = String(p.input ?? '');
      const m = raw.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const cmd = m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : raw;
      calls.push({ turn, name: p.name || 'exec', text: cmd, raw, isError: false, inputBytes: raw.length, cmd });
    } else if (t === 'custom_tool_call_output') {
      const txt = Array.isArray(p.output) ? p.output.map(x => x.text || '').join('\n') : String(p.output ?? '');
      calls.push({ turn, name: '<result>', text: txt, raw: '', isError: false, inputBytes: 0, cmd: '' });
    }
  }
  return { turnCount, calls, usage };
}

function parseOpencode(file) {
  const calls = []; const usage = []; let turn = 1; let turnCount = 0;
  for (const d of jl(file)) {
    const p = d.part || {};
    if (d.type === 'step_finish' || d.type === 'step-finish') {
      const tk = p.tokens || {}, cache = tk.cache || {};
      const cRead = cache.read || 0, cWrite = cache.write || 0;
      // opencode-task-runner.mjs folds cacheWrite into `in` and records no cacheWrite field,
      // so realized cost bills it as fresh input. Reproduced exactly, not corrected.
      usage.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, out: (tk.output || 0) + (tk.reasoning || 0) });
      turn++; turnCount++; continue;
    }
    if (d.type === 'tool_use') {
      const st = p.state || {};
      const inp = JSON.stringify(st.input ?? {});
      const out = st.output === undefined ? '' : (typeof st.output === 'string' ? st.output : JSON.stringify(st.output));
      calls.push({ turn, name: p.tool || '', text: inp + '\n' + out, raw: inp,
        isError: st.status === 'error', inputBytes: inp.length,
        cmd: st.input?.command || st.input?.cmd || '' });
    }
  }
  return { turnCount, calls, usage };
}

function parseClaude(file) {
  // Turn = one assistant message id, in first-seen order, counting only usage-bearing ids
  // (mirrors claude-code-accounting.mjs pass 2). Tool calls inside a usage-less id are
  // attributed forward to the next usage-bearing turn.
  const order = [], byId = new Map();
  for (const d of jl(file)) {
    const m = d.message; if (!m || m.role !== 'assistant' || !m.id) continue;
    let g = byId.get(m.id);
    if (!g) { g = { blocks: [], hasUsage: false, seen: new Set(), usage: null, best: -1 }; byId.set(m.id, g); order.push(m.id); }
    for (const b of (m.content || [])) {
      const key = b.type === 'tool_use' ? `tu:${b.id}` : `${b.type}:${String(b.text ?? b.thinking ?? '').slice(0, 120)}`;
      if (g.seen.has(key)) continue; g.seen.add(key); g.blocks.push(b);
    }
    const u = m.usage;
    if (u) {
      const cached = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
      const inTok = (u.input_tokens || 0) + cached + cacheWrite, outTok = u.output_tokens || 0;
      // claude-code-accounting.mjs: the record reporting the most tokens wins; all agree.
      if (inTok + outTok > g.best) { g.best = inTok + outTok; g.usage = { in: inTok, cached, cacheWrite, out: outTok }; }
      if (inTok + outTok > 0) g.hasUsage = true;
    }
  }
  const results = new Map();
  for (const d of jl(file)) {
    const m = d.message; if (!m || m.role !== 'user') continue;
    for (const b of (Array.isArray(m.content) ? m.content : [])) {
      if (b.type !== 'tool_result') continue;
      const c = b.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || JSON.stringify(x)).join('\n') : JSON.stringify(c);
      results.set(b.tool_use_id, { txt, isError: !!b.is_error });
    }
  }
  const calls = []; const usage = []; let turn = 0; let turnCount = 0;
  for (const id of order) {
    const g = byId.get(id);
    if (g.hasUsage) { turn++; turnCount++; usage.push(g.usage); }
    const at = Math.max(1, turn || 1);
    for (const b of g.blocks) {
      if (b.type !== 'tool_use') continue;
      const inp = JSON.stringify(b.input ?? {});
      const r = results.get(b.id) || { txt: '', isError: false };
      calls.push({ turn: at, name: b.name || '', text: inp + '\n' + r.txt, raw: inp,
        isError: r.isError, inputBytes: inp.length, cmd: b.input?.command || '' });
    }
  }
  return { turnCount, calls, usage };
}

const PARSE = { codex: parseCodex, opencode: parseOpencode, 'claude-code': parseClaude };

function firstEditTurn(harness, calls) {
  for (const c of calls) { if (c.name !== '<result>' && mutates(harness, c)) return c.turn; }
  return null;
}

// ── cost, split at the checkpoint ─────────────────────────────────────────────────────
function turnCosts(rows, price) {
  const out = []; let prevIn = 0;
  for (const tu of rows) {
    const cached = Number(tu.cached) || 0;
    const cacheWrite = Math.max(0, Math.min(Number(tu.cacheWrite) || 0, (tu.in || 0) - cached));
    const real = (((tu.in || 0) - cached - cacheWrite) * price.in + cacheWrite * price.in * 1.25
      + cached * price.cache + (tu.out || 0) * price.out) / 1e6;
    const cacheable = (tu.in || 0) < prevIn ? 0 : Math.min(prevIn, tu.in || 0);
    const bp = (((tu.in || 0) - cacheable) * price.in + cacheable * price.cache + (tu.out || 0) * price.out) / 1e6;
    prevIn = tu.in || 0;
    out.push({ t: out.length + 1, real, bp });
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────────────
const report = { generated: 'w0-p7-addressability.mjs', perRollout: [], mismatches: [], parseFail: [] };

for (const [harness, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  const preds = {};
  for (const arm of ['sweet', 'native']) {
    const f = path.join(RESULTS, run, `preds-${arm}.jsonl`);
    preds[arm] = new Map();
    if (existsSync(f)) for (const o of jl(f)) preds[arm].set(o.instance_id, o.model_patch || '');
  }
  for (const row of rows) {
    if (row.taskId === EXCLUDE_TASK) continue;
    const cell = path.join(RESULTS, run, 'agent-state', `${row.taskId}-${row.arm}`);
    let file = row.rolloutFile;
    if (harness !== 'codex' || !file || !existsSync(file)) {
      const cand = walk(cell).filter(f =>
        harness === 'opencode' ? f.endsWith('attempt-1.stdout.ndjson')
        : harness === 'claude-code' ? (f.endsWith('.jsonl') && f.includes('/claude-home/projects/') && !f.includes('/subagents/'))
        : /rollout-.*\.jsonl$/.test(f)).sort();
      file = cand[row.rep] || cand[0];
    }
    if (!file || !existsSync(file)) { report.parseFail.push({ harness, task: row.taskId, arm: row.arm, rep: row.rep, why: 'no rollout file' }); continue; }

    let parsed; try { parsed = PARSE[harness](file); } catch (e) { report.parseFail.push({ harness, task: row.taskId, arm: row.arm, rep: row.rep, why: String(e.message).slice(0, 80) }); continue; }

    // Cost comes from the usage array reconstructed above, out of THIS rep's own trace.
    // The retained turns/ ledger is written once per (task,arm), so rep 1 overwrote rep 0 and
    // it cannot price rep 0 at all. It is used here only to VALIDATE the reconstruction on
    // the rep it does describe.
    const tf = path.join(RESULTS, run, 'turns', `${row.taskId}-${row.arm}.jsonl`);
    const price = existsSync(tf) ? (jl(tf)[0] || {}).price : null;
    if (!price) { report.parseFail.push({ harness, task: row.taskId, arm: row.arm, rep: row.rep, why: 'no price' }); continue; }
    const turns = turnCosts(parsed.usage, price);
    const totalReal = turns.reduce((a, b) => a + b.real, 0);
    const totalBp = turns.reduce((a, b) => a + b.bp, 0);

    const ledgerDelta = row.realFromTurnsUsd == null ? null : totalReal - row.realFromTurnsUsd;
    const validated = ledgerDelta != null && Math.abs(ledgerDelta) <= 5e-6;
    if (!validated) {
      report.mismatches.push({ harness, task: row.taskId, arm: row.arm, rep: row.rep,
        turnSum: +totalReal.toFixed(6), rowReal: row.realFromTurnsUsd == null ? null : +row.realFromTurnsUsd.toFixed(6),
        delta: ledgerDelta == null ? null : +ledgerDelta.toFixed(6) });
    }

    const T = firstEditTurn(harness, parsed.calls);
    const after = T == null ? [] : turns.filter(x => x.t > T);
    const realAfter = after.reduce((a, b) => a + b.real, 0);
    const bpAfter = after.reduce((a, b) => a + b.bp, 0);

    const patch = preds[row.arm].get(row.taskId) || '';
    const patchFiles = [...new Set([...patch.matchAll(/^(?:diff --git a\/(\S+)|\+\+\+ b\/(\S+))/gm)]
      .map(m => m[1] || m[2]).filter(Boolean).filter(p => p !== '/dev/null'))];
    const preText = parsed.calls.filter(c => T == null || c.turn <= T).map(c => c.text).join('\n');
    const seen = patchFiles.filter(p => preText.includes(p));
    const localized = patchFiles.length > 0 && seen.length === patchFiles.length;

    const editCalls = parsed.calls.filter(c => c.name !== '<result>' && mutates(harness, c));
    const fumbles = editCalls.filter(c => c.isError).length;
    const fumbleTurnSet = [...new Set(editCalls.filter(c => c.isError).map(c => c.turn))];
    const maxInput = parsed.calls.reduce((a, c) => Math.max(a, c.inputBytes || 0), 0);
    // F5 — see W0-P7-RESULTS.md §"pre-registration defect". The registered detector (a
    // >=50,000-byte tool input) finds NOTHING: the largest tool input in all 192 rollouts is
    // 6,166 bytes. The runaway payload never reaches the transcript as a tool call — it is
    // truncated at the model's output cap, so the surviving marker is the OUTPUT side.
    const maxOutTok = parsed.usage.reduce((a, u) => Math.max(a, (u && u.out) || 0), 0);
    const degenLegacy = maxInput >= DEGEN_INPUT_BYTES || parsed.calls.some(c => ROLE_TAG.test(c.text || ''));
    const degen = maxOutTok >= OUTPUT_CAP_FLAG || degenLegacy;

    report.perRollout.push({
      harness, task: row.taskId, arm: row.arm, rep: row.rep,
      resolved: !!row.resolved, calls: row.calls, parsedCalls: parsed.calls.filter(c => c.name !== '<result>').length,
      turnCountParsed: parsed.turnCount, turnCountLedger: turns.length,
      firstEditTurn: T, totalReal: +totalReal.toFixed(6), realAfter: +realAfter.toFixed(6),
      totalBp: +totalBp.toFixed(6), bpAfter: +bpAfter.toFixed(6),
      patchFiles: patchFiles.length, seenBefore: seen.length, localized,
      editCalls: editCalls.length, fumbles,
      fumbleTurns: fumbleTurnSet.length,
      // F4: a fumbled edit wastes the whole turn that issued it, so the recoverable money is
      // that turn's realized cost — not a token estimate.
      fumbleCostReal: +turns.filter(x => fumbleTurnSet.includes(x.t)).reduce((a, b) => a + b.real, 0).toFixed(6),
      maxInputBytes: maxInput, maxOutTok, degen, degenLegacy,
      ledgerDelta: ledgerDelta == null ? null : +ledgerDelta.toFixed(6), validated,
      rowEditCount: row.toolCounts?.edit ?? null, patchBytes: patch.length,
      // GATE 0. The harness's own `toolCounts.edit` is NOT usable ground truth here: codex
      // packs apply_patch inside `exec`, so its counter reads 0 on rollouts that plainly
      // produced a patch. The airtight test is the patch itself — a non-empty model_patch
      // proves the checkout was mutated, so a checkpoint MUST exist.
      gate0: patch.trim().length > 0 ? (T != null) : null,
      gate0Reverse: patch.trim().length === 0 && T != null,
    });
  }
}

const OUT = process.argv[2] || '/root/p7-census.json';
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`rollouts=${report.perRollout.length} parseFail=${report.parseFail.length} ledgerMismatch=${report.mismatches.length} -> ${OUT}`);
