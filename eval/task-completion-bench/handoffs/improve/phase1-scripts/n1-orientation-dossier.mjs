// ADJACENT VARIANT — "orientation dossier", derived from this session's own measurements
// rather than from the slate.
//
// R-1 failed its localisation clause: a ranked top-5 file list hits only 66% of solved rollouts.
// But R-1's ECONOMICS passed with room to spare — carrying 500 tokens costs 1.1-1.8% while the
// first two requests are worth 8.2-12.6%. So the question is not "can we afford to push context"
// but "what content removes an early request with certainty?"
//
// A ranked guess about WHERE THE ANSWER IS can be wrong. A fact about the REPOSITORY cannot:
// the directory tree, the dependency manifest, the test command, the entry points. Those are
// model-free, computable at index time, and identical for every rollout on that task.
//
// This classifies the FIRST THREE tool calls of every rollout by whether a precomputed,
// model-free artifact could have answered them, then prices the removal against the carry cost.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };

// ---- intent classification -------------------------------------------------
// PRECOMPUTABLE = answerable from a static artifact built at index time, with no model and no
// knowledge of the issue. Everything else needs the issue, so a dossier cannot remove it.
// ORDER MATTERS: actions that depend on the CURRENT working tree are matched first, so a
// command like `run_tests` can never fall through to a static-looking pattern.
// PRECOMPUTABLE is deliberately narrow: only the base-checkout directory tree and the
// dependency/build manifests. Both are static, model-free, and identical for every rollout on
// a task. Test EXECUTION, git state and any issue-driven search are excluded by construction.
const CLASSES = [
  ['run-tests',       /run_tests|npm (run )?test|\bpytest\b|cargo test|go test|mix test|phpunit|swift test|devtools::test|\btestthat\b|jest\b|mocha\b/i, false],
  ['edit',            /apply_patch|\*\*\* Begin Patch|"tool":"(edit|write|patch)"|^Edit |^Write |"name":"(Edit|Write|MultiEdit)"/i, false],
  ['orient-vcs',      /git (status|log|diff|branch|rev-parse|show)/i,                                                false],
  ['locate-symbol',   /\bss-(search|grep|find|semantic)\b|"tool":"grep"|\bgrep\b|\brg\b|^Grep /i,                  false],
  ['orient-manifest', /package\.json|pyproject\.toml|setup\.(py|cfg)|Cargo\.toml|go\.mod|mix\.exs|composer\.json|DESCRIPTION\b|\.csproj|Package\.swift|pubspec\.yaml|Makefile|tsconfig\.json/i, true],
  ['orient-tree',     /\b(ls|tree|fd)\b|find\s+[.\/]|"tool":"(glob|list)"|^Glob |^LS |"name":"(Glob|LS)"/i,          true],
  ['read-file',       /\bss-read\b|"tool":"read"|^Read |sed -n|\bcat\b|head -|tail -|"name":"Read"/i,               false],
];
function classify(cmd) {
  for (const [name, re, pre] of CLASSES) if (re.test(cmd)) return { name, pre };
  return { name: 'other', pre: false };
}

function transcripts(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.(jsonl|ndjson)$/.test(e.name)) out.push(p); } };
  walk(root);
  return out.filter(p => !p.includes('/subagents/'));
}

/** Ordered (turn, callsIssued) for one rollout. */
function timeline(harness, file) {
  const turns = [];
  const txt = readFileSync(file, 'utf8');
  if (harness === 'codex') {
    let pending = [];
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      if (ty === 'function_call' || ty === 'custom_tool_call') pending.push(String(p.input ?? p.arguments ?? ''));
      else if (ty === 'token_count' && p.info?.last_token_usage) {
        const u = p.info.last_token_usage;
        turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
          out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), calls: pending });
        pending = [];
      }
    }
  } else if (harness === 'opencode') {
    const seen = new Set(); let pending = [];
    const find = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 6) return null;
      if (o.tokens && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
      for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; } return null; };
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (o.type === 'tool_use') pending.push(`"tool":"${o.part?.tool}" ${JSON.stringify(o.part?.state?.input || {})}`);
      const u = find(o); if (!u) continue;
      const k = `${o.part?.id || ''}|${u.total}|${u.output}`; if (seen.has(k)) continue; seen.add(k);
      const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
      const inn = (u.input || 0) + cr + cw, outp = (u.output || 0) + (u.reasoning || 0);
      if (!inn && !outp) continue;
      turns.push({ in: inn, cached: cr, cacheWrite: cw, out: outp, calls: pending }); pending = [];
    }
  } else {
    const byId = new Map(), order = [];
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
      if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1, calls: [] }); order.push(m.id); }
      const r = byId.get(m.id), u = m.usage || {};
      const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      if (tot > r.best) { r.best = tot; r.usage = u; }
      for (const b of (m.content || [])) if (b.type === 'tool_use') r.calls.push(`${b.name} ${JSON.stringify(b.input || {})}`);
    }
    for (const id of order) { const r = byId.get(id), u = r.usage || {};
      const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
      const inn = (u.input_tokens || 0) + cr + cw;
      if (!inn && !(u.output_tokens || 0)) continue;
      turns.push({ in: inn, cached: cr, cacheWrite: cw, out: u.output_tokens || 0, calls: r.calls }); }
  }
  return turns;
}

const tally = new Map();
const loaded = [];
for (const [harness, run] of Object.entries(RUNS)) {
  for (const r of JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'))) {
    const cell = path.join(RESULTS, run, 'agent-state', `${r.taskId}-${r.arm}`);
    if (!existsSync(cell)) continue;
    const h = harness === 'screen' ? 'claude' : harness;
    let bestT = null, bd = Infinity;
    const rec = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    const price = priceFor(r.model);
    for (const f of transcripts(cell)) {
      if (h === 'claude') { const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
        const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== r.rep) continue; }
      const T = timeline(h, f); if (!T.length) continue;
      const d = Math.abs(costFromTurns(T, price).idealUsd - rec);
      if (d < bd) { bd = d; bestT = T; }
    }
    if (!bestT) continue;
    loaded.push({ harness, run, task: r.taskId, arm: r.arm, rep: r.rep, price, T: bestT,
      base: costFromTurns(bestT, price).idealUsd, resolved: !!r.resolved });
    for (let i = 0; i < Math.min(3, bestT.length); i++)
      for (const c of bestT[i].calls) {
        const k = `${r.arm}|${i}|${classify(c).name}`;
        tally.set(k, (tally.get(k) || 0) + 1);
      }
  }
}

console.log(`=== what do the first three requests actually do? (${loaded.length} rollouts) ===\n`);
const names = [...new Set([...CLASSES.map(c => c[0]), 'other'])];
for (const arm of ['native', 'sweet']) {
  console.log(`-- ${arm} --`);
  console.log('request'.padEnd(9) + names.map(n => n.slice(0, 15).padStart(16)).join(''));
  for (let i = 0; i < 3; i++) {
    console.log(`#${i + 1}`.padEnd(9) + names.map(n => String(tally.get(`${arm}|${i}|${n}`) || 0).padStart(16)).join(''));
  }
  let pre = 0, tot = 0;
  for (let i = 0; i < 3; i++) for (const n of names) {
    const v = tally.get(`${arm}|${i}|${n}`) || 0; tot += v;
    if (CLASSES.find(c => c[0] === n)?.[2]) pre += v;
  }
  console.log(`   precomputable share of the first three requests: ${pre}/${tot} = ${(pre / Math.max(1, tot) * 100).toFixed(0)}%\n`);
}

// ---- price: remove the LEADING run of precomputable-only requests ----------
console.log('=== pricing: remove the leading requests whose every call is precomputable ===');
for (const D of [500, 1000, 2000]) {
  const per = {};
  for (const L of loaded) {
    const k = `${L.harness}|${L.arm}`;
    per[k] = per[k] || { b: 0, n: 0, removed: 0, cells: 0 };
    let cut = 0;
    while (cut < L.T.length - 1 && L.T[cut].calls.length
           && L.T[cut].calls.every(c => classify(c).pre)) cut++;
    const drop = cut ? L.T[cut].in - L.T[0].in : 0;
    const kept = L.T.slice(cut).map(t => ({ ...t, in: Math.max(L.T[0].in, t.in - drop) + D,
      cached: Math.max(0, (t.cached || 0) - drop) }));
    const nc = costFromTurns(kept, L.price).idealUsd;
    per[k].b += L.base; per[k].n += nc; per[k].removed += cut; per[k].cells++;
  }
  console.log(`\ndossier ${D} tokens:`);
  for (const [k, v] of Object.entries(per).sort()) {
    console.log(`  ${k.padEnd(18)} cells=${String(v.cells).padStart(3)} removed=${String(v.removed).padStart(3)} requests  $${v.b.toFixed(6)} -> $${v.n.toFixed(6)}  ${((v.n / v.b - 1) * 100) >= 0 ? '+' : ''}${((v.n / v.b - 1) * 100).toFixed(2)}%`);
  }
}
