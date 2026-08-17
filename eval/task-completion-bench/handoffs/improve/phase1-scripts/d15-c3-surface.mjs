// D15 — C-3 GATE 0c. The RESPONSE SURFACE, not one point.
//
// HANDOFF-SLATE-A-RESIDUE §5: "Sweep the shape of a mechanism, not one parameter of it."
// gate4 evaluated ONE shape (reset at first edit, every rollout, 900-token handoff) and killed
// the lever. This sweeps the two axes that can change the sign:
//
//   V3  TRIGGER THRESHOLD — reset only when the diagnosis context at the boundary exceeds N
//       tokens. C-3 is plausibly a TAIL lever: deleting 60k of context is worth re-paying a
//       15k prefix; deleting 4k is not. Pooling all rollouts hides that.
//   V4  HANDOFF SIZE — 0 / 300 / 900 / 2000 / 4000 tokens.
//
// It also prints the term that decides the whole lever and that gate4 never showed:
// BASE PREFIX, the system prompt + instruction file + issue that a fresh session must re-pay
// at FULL input rate. A reset pays that twice. If the base prefix is larger than the diagnosis
// context being deleted, no handoff size and no trigger can make the arithmetic work.
//
// This term is TRAJECTORY-INDEPENDENT, which matters: §0 discredits replay COST predictions
// because the live trajectory changes. A changed trajectory changes how many apply turns there
// are; it cannot make the second session skip its own system prompt.
//
// Read-only. No model. $0.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const SETS = {
  'post-C-1': { claude: 'screen-v3-20260812' },
  'pre-C-1': { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' },
};
const WHICH = process.argv[2] || 'pre-C-1';
const ARM = process.argv[3] || 'sweet';
const RUNS = SETS[WHICH];

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
      let pendingEdit = false; const seenPart = new Set();
      const findTokens = (o, depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 6) return null;
        if (o.tokens && typeof o.tokens === 'object' && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
        for (const v of Object.values(o)) { const r = findTokens(v, depth + 1); if (r) return r; }
        return null;
      };
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        if (/"tool":"(edit|write|patch|multiedit|apply_patch)"/i.test(JSON.stringify(o))) pendingEdit = true;
        const u = findTokens(o); if (!u) continue;
        const key = `${o.part?.id || o.messageID || ''}|${u.total}|${u.output}`;
        if (seenPart.has(key)) continue;
        seenPart.add(key);
        const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
        const inp = (u.input || 0) + cr + cw, outp = (u.output || 0) + (u.reasoning || 0);
        if (!inp && !outp) continue;
        turns.push({ in: inp, cached: cr, cacheWrite: cw, out: outp, edit: pendingEdit });
        pendingEdit = false;
      }
    }
    if (turns.length) out.push({ file: f, turns });
  }
  return out;
}

/** Collect every exposed rollout once; the sweep then re-prices without re-parsing. */
const pool = [];
for (const [harness, run] of Object.entries(RUNS)) {
  if (!existsSync(path.join(RESULTS, run, 'rows.json'))) continue;
  for (const r of JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(x => x.arm === ARM)) {
    const cands = rolloutTurns(harness, run, r.taskId, r.arm, r.rep);
    if (!cands.length) continue;
    const price = priceFor(r.model);
    let best = null;
    for (const c of cands) {
      const base = costFromTurns(c.turns, price);
      const d = Math.abs(base.idealUsd - (r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0));
      if (!best || d < best.d) best = { ...c, base, d };
    }
    const T = best.turns, k = T.findIndex(t => t.edit);
    if (k < 1 || k >= T.length - 1) continue;
    pool.push({ harness, price, T, k, base: best.base, resolved: !!r.resolved,
      basePrefix: T[0].in, carried: Math.max(0, T[k].in - T[0].in) });
  }
}

function reprice(p, handoffTokens) {
  const { T, k, price } = p;
  const diag = T.slice(0, k), apply = T.slice(k);
  const start = p.basePrefix + handoffTokens;
  const applyReset = []; let prev = null;
  for (const t of apply) {
    const inc = prev == null ? 0 : Math.max(0, t.in - prev); prev = t.in;
    const nin = applyReset.length ? applyReset[applyReset.length - 1].in + inc : start;
    applyReset.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out });
  }
  return costFromTurns(diag, price).breakPricedUsd + costFromTurns(applyReset, price).breakPricedUsd;
}

console.log(`=== D15 — C-3 response surface (${WHICH} build, arm=${ARM}), breakPricedUsd throughout ===\n`);
console.log('THE TERM THAT DECIDES IT — a fresh session re-pays this at FULL input rate:');
for (const h of Object.keys(RUNS)) {
  const rs = pool.filter(x => x.harness === h); if (!rs.length) continue;
  const bp = rs.reduce((a, x) => a + x.basePrefix, 0) / rs.length;
  const ca = rs.reduce((a, x) => a + x.carried, 0) / rs.length;
  console.log(`  ${h.padEnd(9)} base prefix ${bp.toFixed(0)} tok   diagnosis context deleted ${ca.toFixed(0)} tok   ratio ${(ca / bp).toFixed(2)}x`
    + (ca < bp ? '   <- DELETES LESS THAN IT RE-PAYS' : ''));
}
console.log('\n--- V4: handoff size sweep (reset EVERY exposed rollout) ---');
console.log('handoff'.padEnd(9) + Object.keys(RUNS).map(h => h.padEnd(12)).join(''));
for (const ho of [0, 300, 900, 2000, 4000]) {
  let line = String(ho).padEnd(9);
  for (const h of Object.keys(RUNS)) {
    const rs = pool.filter(x => x.harness === h);
    if (!rs.length) { line += ''.padEnd(12); continue; }
    const b = rs.reduce((a, x) => a + x.base.breakPricedUsd, 0);
    const n = rs.reduce((a, x) => a + reprice(x, ho), 0);
    line += `${((n / b - 1) * 100 >= 0 ? '+' : '')}${((n / b - 1) * 100).toFixed(2)}%`.padEnd(12);
  }
  console.log(line);
}
console.log('\n--- V3: trigger threshold sweep (reset ONLY when diagnosis context > N tok; else unchanged) ---');
console.log('handoff fixed at 900 tokens. "fires" = rollouts above the threshold.');
console.log('N'.padEnd(9) + Object.keys(RUNS).map(h => (h + ' (fires)').padEnd(20)).join(''));
for (const N of [0, 5000, 10000, 20000, 40000, 80000]) {
  let line = String(N).padEnd(9);
  for (const h of Object.keys(RUNS)) {
    const rs = pool.filter(x => x.harness === h);
    if (!rs.length) { line += ''.padEnd(20); continue; }
    let b = 0, n = 0, fires = 0;
    for (const x of rs) {
      b += x.base.breakPricedUsd;
      if (x.carried > N) { n += reprice(x, 900); fires++; } else n += x.base.breakPricedUsd;
    }
    line += `${((n / b - 1) * 100 >= 0 ? '+' : '')}${((n / b - 1) * 100).toFixed(2)}% (${fires}/${rs.length})`.padEnd(20);
  }
  console.log(line);
}
console.log('\n--- best case available anywhere on the surface (per rollout, argmax over BOTH axes) ---');
for (const h of Object.keys(RUNS)) {
  const rs = pool.filter(x => x.harness === h); if (!rs.length) continue;
  let b = 0, n = 0, fires = 0;
  for (const x of rs) {
    b += x.base.breakPricedUsd;
    // oracle: reset this rollout, at its own best handoff size, ONLY if that beats not resetting
    const best = Math.min(...[0, 300, 900, 2000, 4000].map(ho => reprice(x, ho)));
    if (best < x.base.breakPricedUsd) { n += best; fires++; } else n += x.base.breakPricedUsd;
  }
  console.log(`  ${h.padEnd(9)} ORACLE ${((n / b - 1) * 100).toFixed(2)}%  (reset helps on ${fires}/${rs.length} rollouts)`);
}
console.log('\nThe ORACLE line is an upper bound that no policy can reach: it picks per rollout with');
console.log('hindsight. If the oracle itself is near zero, no trigger rule can make this lever pay.');
