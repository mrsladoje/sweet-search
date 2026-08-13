// GATE 6 — C-5 "Dependency-source index tier", corpus audit across all 17 issues.
// Bar (SLATE-A-UBER §5 C-5): "audit all 17 issues and stored losing patches for a deciding
// ambiguity settled only by dependency source, cited specification, or linked implementation.
// Confirm that the exact referenced version can be acquired legally at index time. If no third
// case exists, cap current-bench expectations at one to two tasks."
//
// Part A: mechanical scan of every problem statement for external references.
// Part B: independent re-check of the handoff's decisive claim — that the pytask agents ALREADY
//         saw `exc_info` in tool output, so the failure is not retrieval of an absent corpus.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const TASKS = '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };

const raw = JSON.parse(readFileSync(TASKS, 'utf8'));
const arr = Array.isArray(raw) ? raw : (raw.tasks || Object.values(raw)[0]);

console.log('=== PART A: external references in every problem statement ===\n');
const rowsOut = [];
for (const t of arr) {
  const s = String(t.problem_statement || '');           // metadata the agent itself receives
  const urls = [...s.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map(m => m[0]);
  const ghSrc = urls.filter(u => /github\.com\/[^/]+\/[^/]+\/(blob|tree|commit|pull)/.test(u));
  const specs = urls.filter(u => /rfc|w3\.org|whatwg|spec|ietf|iso|docs?\./i.test(u));
  const importish = [...s.matchAll(/\b(?:from|import|require|use|include)\s+["'`]?([\w./-]+)/g)].map(m => m[1]);
  const namesDep = /\b(pytest|numpy|pandas|lodash|express|django|flask|jest|mocha|rspec|junit|boost|tokio|serde)\b/i.test(s);
  rowsOut.push({ id: t.instance_id, lang: t.language, chars: s.length,
    urls: urls.length, ghSrc: ghSrc.length, specs: specs.length,
    depName: namesDep ? 1 : 0, imports: importish.length,
    sample: (ghSrc[0] || specs[0] || urls[0] || '').slice(0, 90) });
}
rowsOut.sort((a, b) => (b.ghSrc + b.specs + b.depName) - (a.ghSrc + a.specs + a.depName));
console.log('task'.padEnd(44), 'lang'.padEnd(8), 'chars'.padStart(6), 'urls'.padStart(5), 'ghSrc'.padStart(6), 'spec'.padStart(5), 'dep'.padStart(4), ' first external reference');
for (const r of rowsOut) {
  console.log(r.id.padEnd(44), String(r.lang).padEnd(8), String(r.chars).padStart(6), String(r.urls).padStart(5),
    String(r.ghSrc).padStart(6), String(r.specs).padStart(5), String(r.depName).padStart(4), ' ' + r.sample);
}
const withExternal = rowsOut.filter(r => r.ghSrc || r.specs || r.depName);
console.log(`\ntasks with any external source/spec/dependency reference: ${withExternal.length}/${rowsOut.length}`);
console.log(`tasks with a LINKED IMPLEMENTATION (github blob/tree/commit/pull): ${rowsOut.filter(r => r.ghSrc).length}`);

console.log('\n\n=== PART B: did pytask rollouts already SEE the deciding fact in tool output? ===\n');
function transcripts(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(jsonl|ndjson)$/.test(e.name)) out.push(p); } };
  walk(root);
  return out;
}
for (const [h, run] of Object.entries(RUNS)) {
  for (const arm of ['native', 'sweet']) {
    const cell = path.join(RESULTS, run, 'agent-state', `pytask-dev__pytask-210-${arm}`);
    if (!existsSync(cell)) continue;
    for (const f of transcripts(cell)) {
      if (f.includes('/subagents/')) continue;
      const txt = readFileSync(f, 'utf8');
      // count occurrences in TOOL RESULTS only (what the environment showed the model)
      let inResults = 0, inModel = 0;
      for (const line of txt.split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const blob = JSON.stringify(o);
        const n = (blob.match(/exc_info/g) || []).length;
        if (!n) continue;
        const isResult = /tool_result|function_call_output|custom_tool_call_output|"state":\{"status":"completed"/.test(blob)
          || o.type === 'user' || /"role":"user"/.test(blob);
        if (isResult) inResults += n; else inModel += n;
      }
      if (inResults || inModel) {
        console.log(`${h.padEnd(9)} ${arm.padEnd(6)} ${path.basename(f).slice(0, 30).padEnd(32)} exc_info in tool output: ${String(inResults).padStart(3)} | in model text: ${String(inModel).padStart(3)}`);
      }
    }
  }
}

console.log('\n=== PART C: is the referenced dependency source acquirable offline at index time? ===');
const GOLD = '/root/.ss-eval/golden';
const py = readdirSync(GOLD).find(d => d.startsWith('pytask-dev__pytask@30227332'));
console.log('pytask golden checkout:', py || 'ABSENT');
if (py) {
  const root = path.join(GOLD, py);
  const hits = [];
  const walk = (d, depth = 0) => { if (depth > 6) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) { if (/(_pytest|site-packages|\.venv|node_modules)/.test(e.name)) hits.push(p); walk(p, depth + 1); } } };
  walk(root);
  console.log('vendored dependency source inside the checkout:', hits.length ? hits.map(h => h.slice(root.length)).join(', ') : 'NONE — dependency source is not in the indexed corpus');
  const declared = ['pyproject.toml', 'setup.cfg', 'setup.py', 'requirements.txt'].filter(f => existsSync(path.join(root, f)));
  console.log('dependency manifests present (what a resolver would read):', declared.join(', ') || 'none');
}
