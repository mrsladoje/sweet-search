#!/usr/bin/env node
// SLATE-B W0 gate — P2 terminal family-residue audit: the REPLAY.
//
// P2 proposes ss-audit: after an edit and before completion, read the working-tree
// diff and report where the text the agent REPLACED still survives elsewhere. The
// motivating trace is Underscore: claude sweet rewrote `_.has(result, key)` inside
// groupBy and left the identical stem inside countBy thirteen lines below, then
// closed with "no failures introduced".
//
// The gate is two-sided, and the two sides fail in OPPOSITE directions:
//   SENSITIVITY — every losing Underscore sweet patch must surface countBy. An
//                 under-reporting bug here kills a live proposal.
//   SPECIFICITY — residue on already-resolved cells must not flood the completion
//                 boundary. An under-reporting bug here FLATTERS the proposal.
// So neither direction of instrument error is safe, and both are checked against a
// hand-verified control (see w0-p2-controls.mjs).
//
// WHY THE STEM IS SUB-LINE. Hand check of the base tree:
//     448:    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
//     461:    if (_.has(result, key)) result[key]++;           else result[key] = 1;
// The two lines share the stem and diverge after it. A whole-line residue check
// cannot connect them. That is not a tuning choice — a line-granular ss-audit is
// dead on the one trace P2 exists to catch, so the replay reports BOTH granularities
// and lets the noise numbers price the difference.
//
// $0: reads recorded patches and golden checkouts. No agent runs, no grading, no
// network. Goldens are never written to — every tree is materialised with
// `git archive` into a temp dir, applied there, and deleted.
//
// Usage on the box: node w0-p2-residue-replay.mjs > /root/w0-p2.log 2>&1
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const OUT = process.env.OUT || '/root/w0-p2-residue.json';
const RUNS = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
const ARMS = (process.env.ARMS || 'sweet').split(',');

// Loaded lazily: the controls import the pure stem functions from a machine that has
// no task cache, and a top-level read would make the controls unrunnable off-box.
let _specOf = null;
const specOf = () => (_specOf ??= new Map(
  JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'))
    .map(t => [t.instance_id, t])));

// ---------------------------------------------------------------- patch parsing

// Returns [{file, added:[str], removed:[str], hunks:[{removed,added}]}]
export function parsePatch(patch) {
  const files = [];
  let cur = null, hunk = null;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/ b\/(.+)$/);
      cur = { file: m ? m[1] : '?', added: [], removed: [], hunks: [] };
      files.push(cur); hunk = null; continue;
    }
    if (!cur) continue;
    if (raw.startsWith('@@')) { hunk = { removed: [], added: [] }; cur.hunks.push(hunk); continue; }
    if (!hunk) continue;
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) { cur.added.push(raw.slice(1)); hunk.added.push(raw.slice(1)); }
    else if (raw.startsWith('-')) { cur.removed.push(raw.slice(1)); hunk.removed.push(raw.slice(1)); }
  }
  return files;
}

// ---------------------------------------------------------------- stem derivation

export const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Token-level split that keeps identifiers, numbers and single punctuation apart, so a
// trimmed span always lands on a token boundary. Cutting mid-identifier would invent
// stems like `sOwnProperty` that match nothing and silently under-report.
const tokenize = (s) => s.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\s+|[^\s\w$]/g) || [];

// A stem worth auditing must carry meaning. Bare punctuation, a lone keyword or a
// two-character fragment matches everywhere and is the whole reason a naive residue
// list is unusable. This is the ONLY heuristic filter in the pipeline, so it is kept
// explicit rather than folded into the extraction.
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'return', 'end', 'do', 'then', 'let',
  'var', 'const', 'def', 'function', 'fn', 'in', 'is', 'not', 'and', 'or', 'true', 'false',
  'null', 'nil', 'None', 'self', 'this', 'new', 'try', 'catch', 'begin', 'local', 'public',
  'private', 'static', 'void', 'int', 'string', 'bool', 'auto', 'const', 'class']);
// Raw character length is the WRONG axis and the controls proved it: `_.has` is five
// characters and is the entire point of this gate, while `#endif` is six and is pure
// noise. What separates them is structure. Residue matters when the agent replaced a
// REFERENCE to something — a call, a member access, an index, an assignment. A bare
// word is too weak: it matches everywhere and rarely marks a family relationship.
const STRUCTURE = /[.(\[]|::|->|=>|[^=!<>]=[^=]/;
export function meaningfulStem(stem) {
  const n = norm(stem);
  const idents = (n.match(/[A-Za-z_$][\w$]*/g) || []).filter(w => w.length >= 3 && !KEYWORDS.has(w));
  if (idents.length === 0) return false;
  return STRUCTURE.test(n) || idents.length >= 2;
}

// Trim the shared head and tail of a replaced/replacement pair and keep what only the
// REMOVED side had. For the Underscore pair this yields `_.has(result` — enough to find
// the countBy twin, and short of the part where the two call sites legitimately differ.
export function trimmedSpan(removed, added) {
  const a = tokenize(removed), b = tokenize(added);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  let end = a.length - j;
  // Extend to a syntactic boundary. Plain trimming of the Underscore pair stops at
  // `_.has`, because both sides share the argument list — a call NAME without its
  // arguments, which is neither a meaningful unit nor specific enough to search on.
  // Absorbing the balanced group that follows yields `_.has(result, key)`: same twin
  // found, far fewer incidental matches. Bail out on an unbalanced group rather than
  // swallowing the rest of the line.
  const OPEN = { '(': ')', '[': ']' };
  if (OPEN[a[end]]) {
    const close = OPEN[a[end]];
    let depth = 0, k = end;
    for (; k < a.length; k++) {
      if (a[k] === a[end]) depth++;
      else if (a[k] === close && --depth === 0) { k++; break; }
    }
    if (depth === 0 && k > end) end = k;
  }
  return a.slice(i, end).join('').trim();
}

export const similarity = (x, y) => {
  const a = new Set(tokenize(x).filter(t => t.trim())), b = new Set(tokenize(y).filter(t => t.trim()));
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(a.size, b.size);
};

// Two granularities, deliberately produced side by side so the gate can price them.
//   line  — the whole removed line, the naive reading of "replaced stem"
//   span  — the removed-only token span against its best-matching replacement
export function deriveStems(files) {
  const allAdded = files.flatMap(f => f.added.map(norm));
  const keptSomewhere = (stem) => allAdded.some(a => a.includes(norm(stem)));
  const out = { line: [], span: [] };
  for (const f of files) {
    for (const h of f.hunks) {
      for (const rem of h.removed) {
        if (!norm(rem)) continue;
        // whole-line granularity
        if (meaningfulStem(rem) && !keptSomewhere(rem)) out.line.push({ file: f.file, stem: norm(rem), from: norm(rem) });
        // span granularity: pair with the most similar added line in the same hunk
        let best = null, bestS = 0;
        for (const add of h.added) { const s = similarity(rem, add); if (s > bestS) { bestS = s; best = add; } }
        const span = (best && bestS >= 0.34) ? trimmedSpan(rem, best) : rem;
        if (span && meaningfulStem(span) && !keptSomewhere(span)) out.span.push({ file: f.file, stem: norm(span), from: norm(rem) });
      }
    }
  }
  for (const k of ['line', 'span']) {
    const seen = new Set();
    out[k] = out[k].filter(s => { const key = s.file + '\u0000' + s.stem; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return out;
}

// ---------------------------------------------------------------- tree + search

const SKIP_DIR = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'target',
  '.venv', 'venv', '__pycache__', '.tox', 'coverage', '.next', 'bin', 'obj']);
const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|php|go|rs|java|kt|scala|swift|lua|ex|exs|erl|ml|mli|c|h|cc|cpp|hpp|cs|r|R|dart|sh|json|yml|yaml|md|txt|cfg|toml)$/;

function walkFiles(root) {
  const out = [];
  const rec = (d, depth = 0) => {
    if (depth > 12) return;
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) rec(p, depth + 1); continue; }
      if (!TEXT_EXT.test(e.name)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.size > 4e6) continue;
      out.push(p);
    }
  };
  rec(root);
  return out;
}

// The enclosing definition a hit sits in — this is what turns "line 461" into the
// disposition line a human or model can act on ("countBy still calls the old stem").
const DEF_RE = /(?:^|\s)(?:function\s+([\w$]+)|def\s+([\w$]+)|(?:_\.)?([\w$]+)\s*[:=]\s*(?:function|group\(|\(|async|\w+\s*=>)|class\s+([\w$]+)|(?:public|private|protected|static|\s)*[\w<>\[\],\s]+?\s([\w$]+)\s*\([^;]*\)\s*\{)/;
export function enclosingSymbol(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 400; i--) {
    const m = lines[i].match(DEF_RE);
    if (m) { const name = m[1] || m[2] || m[3] || m[4] || m[5]; if (name) return name; }
  }
  return null;
}

function searchTree(root, stems, addedNorm, scopeFiles) {
  const files = scopeFiles ? scopeFiles.map(f => path.join(root, f)) : walkFiles(root);
  const hits = new Map();   // stem -> [{file,line,text,symbol}]
  for (const p of files) {
    let text; try { text = readFileSync(p, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (const s of stems) {
      if (!text.includes(s.stem) && !norm(text).includes(s.stem)) continue;
      for (let i = 0; i < lines.length; i++) {
        const nl = norm(lines[i]);
        if (!nl.includes(s.stem)) continue;
        if (addedNorm.has(nl)) continue;          // the agent wrote this line just now
        if (!hits.has(s.stem)) hits.set(s.stem, []);
        const arr = hits.get(s.stem);
        if (arr.length < 8) arr.push({ file: path.relative(root, p), line: i + 1, text: nl.slice(0, 160), symbol: enclosingSymbol(lines, i) });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------- replay

function materialise(spec) {
  const g = path.join(GOLDEN, spec.repo.replace('/', '__') + '@' + spec.base_commit);
  const dir = mkdtempSync(path.join(tmpdir(), 'p2-'));
  // git archive, never a copy: the golden checkouts are shared state and a stray
  // `git apply` into one would silently poison every later replay.
  execFileSync('sh', ['-c', `git -C ${JSON.stringify(g)} archive HEAD | tar -x -C ${JSON.stringify(dir)}`],
    { stdio: 'ignore', timeout: 300000 });
  return dir;
}

// Guarded so w0-p2-controls.mjs can import the pure stem functions and assert against
// the hand-verified Underscore case WITHOUT triggering a full sweep on import.
const rows = [];
function replay() {
for (const run of RUNS) {
  for (const arm of ARMS) {
    for (const [rep, sub] of [[0, ''], [1, 'rep-1/']]) {
      const pf = path.join(RESULTS, run, arm, sub + 'patches.json');
      let patches; try { patches = JSON.parse(readFileSync(pf, 'utf8')); } catch { console.log(`skip ${pf}`); continue; }
      for (const rec of Object.values(patches)) {
        const id = rec.instance_id;
        const spec = specOf().get(id);
        const row = { run, arm, rep, id, harness: run.split('-')[1] };
        if (!spec) { row.status = 'NO_SPEC'; rows.push(row); continue; }
        if (!rec.patch || !rec.patch.trim()) { row.status = 'EMPTY_PATCH'; rows.push(row); continue; }
        const files = parsePatch(rec.patch);
        const stems = deriveStems(files);
        row.touched = files.map(f => f.file);
        row.stemsLine = stems.line.length;
        row.stemsSpan = stems.span.length;
        let dir = null;
        try {
          dir = materialise(spec);
          try {
            execFileSync('git', ['apply', '--unsafe-paths', '--directory', '.', '-p1', '-'],
              { cwd: dir, input: rec.patch, stdio: ['pipe', 'ignore', 'pipe'], timeout: 120000 });
            row.applied = true;
          } catch (e) {
            row.applied = false;
            row.applyErr = String(e.stderr || e.message || e).slice(0, 200);
          }
          const addedNorm = new Set(files.flatMap(f => f.added.map(norm)).filter(Boolean));
          const inTree = row.touched.filter(f => { try { statSync(path.join(dir, f)); return true; } catch { return false; } });
          for (const gran of ['line', 'span']) {
            for (const [scopeName, scopeFiles] of [['touched', inTree], ['repo', null]]) {
              const hits = searchTree(dir, stems[gran], addedNorm, scopeFiles);
              const items = [...hits.entries()].map(([stem, hs]) => ({ stem, n: hs.length, hits: hs }));
              row[`${gran}_${scopeName}`] = { items: items.length, hits: items.reduce((a, x) => a + x.n, 0), detail: items };
            }
          }
          row.status = 'OK';
        } catch (e) {
          row.status = 'ERROR';
          row.err = String(e.message || e).slice(0, 300);
        } finally {
          if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }
        }
        rows.push(row);
        const st = row.span_touched;
        console.log(`[${row.status.padEnd(11)}] ${run.split('-')[1].padEnd(11)} rep${rep} ${id.padEnd(42)} `
          + `stems=${String(row.stemsSpan || 0).padStart(3)} residue(span/touched)=${st ? st.items + ' items / ' + st.hits + ' hits' : '-'}`
          + `${row.applied === false ? '  APPLY-FAIL' : ''}`);
        writeFileSync(OUT, JSON.stringify(rows, null, 2));
      }
    }
  }
}

writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`\nwritten: ${OUT}   rows=${rows.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('w0-p2-residue-replay.mjs')) replay();
