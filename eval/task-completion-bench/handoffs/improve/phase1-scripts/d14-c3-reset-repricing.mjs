// D14 — C-3 GATE 0b. Re-price the context-reset replay on ALL THREE cost columns.
//
// HANDOFF-SLATE-A-RESIDUE §3.A: "Use breakPricedCostUsd, not idealCostUsd. ... This single line
// is why C-3's replay may have been wrong in the direction that matters — check whether the
// original gate used the right column."
//
// gate4-c3-context-reset.mjs reported ONE column (idealUsd) and the answer was +2.7% to +7.5%.
// This script is gate4's simulation, unchanged in its mechanics, printing ideal / realized /
// breakPriced side by side so the column question is settled by measurement rather than argument.
//
// It also adds the thing gate4 never showed: the TOKEN MASS on each side of the boundary. C-3's
// second benefit channel (the one the re-derivation census in d13 does not cover) is that every
// apply-phase turn re-sends the whole diagnosis context. If that mass is small, there is nothing
// to delete; if it is large, deleting it is worth something and the question is only whether the
// fresh prefix's full-rate re-pay eats the saving.
//
// Read-only. No model. $0.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
// build-tagged: NEVER pool a pre-C-1 run with a post-C-1 run (HANDOFF §1.5 trap 9)
const SETS = {
  'post-C-1': { claude: 'screen-v3-20260812' },
  'pre-C-1': { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' },
};
const WHICH = process.argv[2] || 'pre-C-1';
const HANDOFF_TOKENS = +(process.argv[3] || 900);
const ARM = process.argv[4] || 'sweet';
const RUNS = SETS[WHICH];

/** Ordered (turn, hadEdit) for one rollout, by harness. Identical to gate4 — do not "improve". */
function rolloutTurns(harness, run, taskId, arm, rep) {
  const state = path.join(RESULTS, run, 'agent-state', `${taskId}-${arm}`);
  const files = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl') || e.name.endsWith('.ndjson')) files.push(p); } };
  if (harness === 'codex') walk(path.join(state, 'codex-home', 'sessions'));
  else if (harness === 'claude') walk(path.join(state, 'claude-home', 'projects'));
  else walk(path.join(state, 'opencode-retained'));
  const out = [];
  for (const f of files) {
    if (f.includes('/subagents/')) continue;
    if (harness === 'claude') {
      const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
      const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== rep) continue;
    }
    const turns = [], byId = new Map(), order = [];
    if (harness === 'codex') {
      let cur = null;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty === 'token_count' && p.info?.last_token_usage) {
          const u = p.info.last_token_usage;
          turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
            out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), edit: !!cur });
          cur = null;
        } else if (ty === 'function_call' || ty === 'custom_tool_call') {
          const cmd = String(p.input ?? p.arguments ?? '');
          if (/apply_patch|\bpatch\b|<<'?PATCH'?/.test(cmd)) cur = true;
        }
      }
    } else if (harness === 'claude') {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let e; try { e = JSON.parse(t); } catch { continue; }
        const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
        if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1, edit: false }); order.push(m.id); }
        const r = byId.get(m.id), u = m.usage || {};
        const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        if (tot > r.best) { r.best = tot; r.usage = u; }
        for (const b of (m.content || [])) if (b.type === 'tool_use' && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) r.edit = true;
      }
      for (const id of order) {
        const r = byId.get(id), u = r.usage || {};
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inn = (u.input_tokens || 0) + cr + cw;
        if (!inn && !(u.output_tokens || 0)) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: u.output_tokens || 0, edit: r.edit });
      }
    } else {
      let pendingEdit = false;
      const seenPart = new Set();
      const findTokens = (o, depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 6) return null;
        if (o.tokens && typeof o.tokens === 'object' && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
        for (const v of Object.values(o)) { const r = findTokens(v, depth + 1); if (r) return r; }
        return null;
      };
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const blob = JSON.stringify(o);
        if (/"tool":"(edit|write|patch|multiedit|apply_patch)"/i.test(blob)) pendingEdit = true;
        const u = findTokens(o);
        if (!u) continue;
        const key = `${o.part?.id || o.messageID || ''}|${u.total}|${u.output}`;
        if (seenPart.has(key)) continue;
        seenPart.add(key);
        const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
        const inp = (u.input || 0) + cr + cw;
        const outp = (u.output || 0) + (u.reasoning || 0);
        if (!inp && !outp) continue;
        turns.push({ in: inp, cached: cr, cacheWrite: cw, out: outp, edit: pendingEdit });
        pendingEdit = false;
      }
    }
    if (turns.length) out.push({ file: f, turns });
  }
  return out;
}

const results = [];
for (const [harness, run] of Object.entries(RUNS)) {
  if (!existsSync(path.join(RESULTS, run, 'rows.json'))) { console.log(`(skip ${run} — absent)`); continue; }
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(r => r.arm === ARM);
  for (const r of rows) {
    const cands = rolloutTurns(harness, run, r.taskId, r.arm, r.rep);
    if (!cands.length) continue;
    const price = priceFor(r.model);
    let best = null;
    // trap #3: pick the transcript whose REPLAYED cost matches the row, not the longest
    for (const c of cands) {
      const base = costFromTurns(c.turns, price);
      const d = Math.abs(base.idealUsd - (r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0));
      if (!best || d < best.d) best = { ...c, base, d };
    }
    const T = best.turns;
    const k = T.findIndex(t => t.edit);
    const recorded = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    if (k < 1 || k >= T.length - 1) continue;   // unexposed: no diagnosis or no apply phase
    const diag = T.slice(0, k), apply = T.slice(k);
    const basePrefix = T[0].in;
    const start = basePrefix + HANDOFF_TOKENS;
    const applyReset = [];
    let prev = null;
    for (const t of apply) {
      const inc = prev == null ? 0 : Math.max(0, t.in - prev);
      prev = t.in;
      const nin = applyReset.length ? applyReset[applyReset.length - 1].in + inc : start;
      applyReset.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out });
    }
    const cDiag = costFromTurns(diag, price), cApply = costFromTurns(applyReset, price);
    // token mass: what the reset actually deletes, and what the apply phase re-sends of it
    const carried = Math.max(0, T[k].in - basePrefix);          // diagnosis context alive at the boundary
    const applyResend = apply.reduce((a, t) => a + Math.min(t.in, carried), 0);   // re-sent every apply turn
    const totalIn = T.reduce((a, t) => a + t.in, 0);
    results.push({ harness, task: r.taskId, rep: r.rep, recorded, resolved: !!r.resolved,
      drift: best.d / Math.max(1e-9, recorded), turns: T.length, k,
      baseIdeal: best.base.idealUsd, baseBrk: best.base.breakPricedUsd, baseReal: best.base.realFromTurnsUsd,
      newIdeal: cDiag.idealUsd + cApply.idealUsd,
      newBrk: cDiag.breakPricedUsd + cApply.breakPricedUsd,
      newReal: cDiag.realFromTurnsUsd + cApply.realFromTurnsUsd,
      carried, applyResend, totalIn, applyTurns: apply.length });
  }
}

const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
const d = (n, b) => `${((n / b - 1) * 100 >= 0 ? '+' : '')}${((n / b - 1) * 100).toFixed(2)}%`;
console.log(`=== D14 — C-3 context reset, ALL THREE COLUMNS (${WHICH} build, arm=${ARM}, handoff=${HANDOFF_TOKENS} tok) ===\n`);
for (const h of Object.keys(RUNS)) {
  for (const scope of ['ALL EXPOSED', 'SOLVED ONLY']) {
    const rs = results.filter(x => x.harness === h && (scope === 'ALL EXPOSED' || x.resolved));
    if (!rs.length) { console.log(`${h} ${scope}: none`); continue; }
    console.log(`-- ${h} / ${scope} --  ${rs.length} rollouts, worst baseline repro drift ${(Math.max(...rs.map(x => x.drift)) * 100).toFixed(1)}%`);
    console.log(`   idealUsd       $${sum(rs, 'baseIdeal').toFixed(6)} -> $${sum(rs, 'newIdeal').toFixed(6)}   ${d(sum(rs, 'newIdeal'), sum(rs, 'baseIdeal'))}   <- the column gate4 used`);
    console.log(`   breakPricedUsd $${sum(rs, 'baseBrk').toFixed(6)} -> $${sum(rs, 'newBrk').toFixed(6)}   ${d(sum(rs, 'newBrk'), sum(rs, 'baseBrk'))}   <- the column §3.A requires`);
    console.log(`   realFromTurns  $${sum(rs, 'baseReal').toFixed(6)} -> $${sum(rs, 'newReal').toFixed(6)}   ${d(sum(rs, 'newReal'), sum(rs, 'baseReal'))}`);
    if (scope === 'ALL EXPOSED') {
      const cr = sum(rs, 'carried') / rs.length, re = sum(rs, 'applyResend') / rs.length, ti = sum(rs, 'totalIn') / rs.length;
      console.log(`   MASS  diagnosis context at boundary ${cr.toFixed(0)} tok/rollout | re-sent across apply turns ${re.toFixed(0)} tok (${(re / ti * 100).toFixed(1)}% of all billed input) | apply turns ${(sum(rs, 'applyTurns') / rs.length).toFixed(1)}`);
    }
    console.log('');
  }
}
console.log('READ: if breakPriced is WORSE than ideal, gate4 flattered the lever and the kill stands harder.');
console.log('If breakPriced is BETTER, gate4 penalised it and the verdict has to be re-taken live.');
