// D13 — C-3 GATE 0. The $0 census that decides whether a live context-reset A/B is worth buying.
//
// C-3's pre-registered proximal metric (HANDOFF-SLATE-A-RESIDUE §3.A) is:
//     "count of facts RE-DERIVED after the reset that were present before it"
//     direction: DOWN
//
// This script measures that quantity on the BASELINE (no reset), which is the ceiling the
// lever is competing for. The logic:
//
//   - boundary k  = the first edit call. Everything before it is diagnosis; from k on is
//                   apply/prove. That is exactly where gate4's replay cut the context.
//   - PRE set     = every retrieval target touched before k (files read, query strings issued).
//   - RE-DERIVED  = a retrieval call at or after k whose target is ALREADY in the PRE set.
//
// Reading it:
//   * If RE-DERIVED is LARGE, the agent is paying to re-look at things it already had, and a
//     typed handoff that carries those facts forward has headroom. Buy the A/B.
//   * If RE-DERIVED is NEAR ZERO, the post-boundary phase is not re-deriving anything, so a
//     reset can only ADD re-derivation (it deletes the context that made re-derivation
//     unnecessary). The lever has no headroom and no live run can rescue it.
//
// Also sized here: the token mass in the pre-boundary phase, i.e. how much a reset would
// actually delete, and what fraction of the rollout's billed input that is.
//
// Read-only over retained transcripts. No model. $0.
//
// TRAP FIXES vs d12 (HANDOFF §1.5):
//   #2 reads chain with `&&` — the command is SPLIT on &&/;/| and every segment classified,
//      instead of a single regex that stops at the first `&`. d12's regex misses 55/157 codex reads.
//   #1 `ss-read <file> <start>` is a SINGLE LINE, not start-to-EOF.
//   #5 reps share agent-state/<task>-<arm>; every session file is walked.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
// Default: the C-4 A/B's OFF cells. Those are the current shipped build with the lever off,
// i.e. a clean post-C-1 baseline. Never pooled with pre-C-1 runs (HANDOFF §1.5 trap 9).
const CELLS = (process.argv[2] || 'c4b-codex-off:codex,c4b-opencode-off:opencode,c4b-claudecode-off:claudecode')
  .split(',').map(s => { const [dir, h] = s.split(':'); return { dir, h }; });

const walk = (d, pred, depth = 0, out = []) => {
  if (depth > 10) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, pred, depth + 1, out); else if (pred(p)) out.push(p); }
  return out;
};

/** Split a shell command into segments so a chained `a && b && c` yields three commands. */
const segments = cmd => String(cmd || '').split(/\s*(?:&&|\|\||[;|\n])\s*/).map(s => s.trim()).filter(Boolean);

/** Classify ONE segment into a retrieval/edit/test kind plus its target. */
function classifySegment(seg) {
  const first = seg.split(/\s+/)[0] || '';
  const base = first.replace(/^.*\//, '');
  const rest = seg.slice(first.length).trim();
  const argOf = () => {
    // first non-flag token, stripped of quotes and of a :a-b span suffix
    for (const tk of rest.split(/\s+/)) {
      if (!tk || tk.startsWith('-')) continue;
      return tk.replace(/^['"]|['"]$/g, '').replace(/:\d+(-\d+)?$/, '');
    }
    return null;
  };
  // query string = everything after the binary, flags stripped, normalized. Used as the
  // "fact" identity for search-shaped tools, where the target is a query not a file.
  const queryOf = () => rest.replace(/(^|\s)-{1,2}[\w-]+(=\S+)?/g, ' ')
    .replace(/['"]/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ') || null;

  if (base === 'ss-read')   return { kind: 'read',   target: argOf() };
  if (base === 'ss-search' || base === 'ss-grep' || base === 'ss-find' || base === 'ss-semantic')
    return { kind: 'search', target: queryOf() };
  if (base === 'ss-trace')  return { kind: 'search', target: queryOf() };
  if (base === 'cat' || base === 'head' || base === 'tail' || base === 'sed' || base === 'less' || base === 'bat')
    return { kind: 'read',   target: argOf() };
  if (base === 'rg' || base === 'grep' || base === 'ag' || base === 'ack')
    return { kind: 'search', target: queryOf() };
  if (base === 'find' || base === 'ls')  return { kind: 'search', target: queryOf() };
  if (base === 'run_tests') return { kind: 'test', target: null };
  if (/apply_patch|str_replace/.test(seg)) return { kind: 'edit', target: argOf() };
  return { kind: 'other', target: null };
}

/** Reduce a full command (possibly chained) to an ordered list of classified events. */
// Codex encodes the shell command differently across CLI versions, and getting this wrong
// silently under-counts the codex leg to near zero:
//   0.146  custom_tool_call name="exec", input = a JS snippet:
//            const r = await tools.exec_command({cmd:"ss-grep \"x\" -k 20","workdir":...})
//   0.141  function_call, arguments = {"command":["bash","-lc","<cmd>"]}
// Both are reduced to the bare shell command here. A parser that classifies by first token
// would otherwise see `const` or `bash` and file every retrieval as 'other'.
function codexCommandOf(p) {
  const raw = String(p.input ?? p.arguments ?? '');
  if (!raw) return '';
  const m = /exec_command\(\s*\{\s*cmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (m) return m[1].replace(/\\(["\\nrt])/g, (s, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j.command)) {
      const a = j.command;
      // strip a `bash -lc` / `sh -c` wrapper so the first token is the real binary
      if (a.length >= 3 && /^(ba)?sh$/.test(a[0]) && /^-[lc]*c$/.test(a[1])) return a.slice(2).join(' ');
      return a.join(' ');
    }
    if (typeof j.cmd === 'string') return j.cmd;
  } catch { /* not JSON */ }
  return raw;
}

function eventsFromCommand(cmd) {
  const out = [];
  for (const seg of segments(cmd)) {
    const c = classifySegment(seg);
    if (c.kind !== 'other') out.push(c);
  }
  // A command that contained an apply_patch heredoc may not split cleanly; catch it whole.
  if (!out.length && /apply_patch|<<\s*'?PATCH'?|str_replace/.test(cmd)) out.push({ kind: 'edit', target: null });
  return out;
}

function streamCodex(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    for (const f of walk(path.join(asDir, d, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'))) {
      const ev = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty !== 'function_call' && ty !== 'custom_tool_call') continue;
        ev.push(...eventsFromCommand(codexCommandOf(p)));
      }
      if (ev.length) out.push({ cell: d, file: f, ev });
    }
  }
  return out;
}

function streamOpencode(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    for (const f of walk(path.join(asDir, d, 'opencode-retained'), p => p.endsWith('.stdout.ndjson'))) {
      const ev = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        if (o.type !== 'tool_use') continue;
        const part = o.part || {}; const inp = part.state?.input || {};
        if (part.tool === 'bash') ev.push(...eventsFromCommand(inp.command));
        else if (/^(edit|write|patch|multiedit|apply_patch|str_replace)/i.test(part.tool || ''))
          ev.push({ kind: 'edit', target: inp.filePath || null });
        else if (/^read$/i.test(part.tool || '')) ev.push({ kind: 'read', target: inp.filePath || null });
        else if (/^(grep|glob|list)$/i.test(part.tool || ''))
          ev.push({ kind: 'search', target: String(inp.pattern || inp.query || '').toLowerCase() || null });
      }
      if (ev.length) out.push({ cell: d, file: f, ev });
    }
  }
  return out;
}

function streamClaude(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    for (const f of walk(path.join(asDir, d, 'claude-home', 'projects'), p => p.endsWith('.jsonl'))
      .filter(p => !p.includes('/subagents/'))) {
      const ev = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        for (const b of (o.message?.content || [])) {
          if (b.type !== 'tool_use') continue;
          if (b.name === 'Bash') ev.push(...eventsFromCommand(b.input?.command));
          else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) ev.push({ kind: 'edit', target: b.input?.file_path || null });
          else if (b.name === 'Read') ev.push({ kind: 'read', target: b.input?.file_path || null });
          else if (/^(Grep|Glob)$/.test(b.name)) ev.push({ kind: 'search', target: String(b.input?.pattern || '').toLowerCase() || null });
        }
      }
      if (ev.length) out.push({ cell: d, file: f, ev });
    }
  }
  return out;
}

const STREAM = { codex: streamCodex, opencode: streamOpencode, claudecode: streamClaude };

/** The census, per cell. */
function census(streams) {
  const m = {
    rollouts: 0, noEdit: 0, noPost: 0,
    preRetrieval: 0, postRetrieval: 0, rederived: 0,
    rederivedRead: 0, rederivedSearch: 0,
    perRollout: [], preShare: [],
  };
  for (const s of streams) {
    m.rollouts++;
    const k = s.ev.findIndex(e => e.kind === 'edit');
    if (k < 0) { m.noEdit++; continue; }
    if (k >= s.ev.length - 1) { m.noPost++; continue; }
    const pre = new Set();
    let preN = 0;
    for (let i = 0; i < k; i++) {
      const e = s.ev[i];
      if (e.kind === 'read' || e.kind === 'search') { preN++; if (e.target) pre.add(`${e.kind}:${e.target}`); }
    }
    let postN = 0, red = 0, redR = 0, redS = 0;
    for (let i = k; i < s.ev.length; i++) {
      const e = s.ev[i];
      if (e.kind !== 'read' && e.kind !== 'search') continue;
      postN++;
      if (e.target && pre.has(`${e.kind}:${e.target}`)) { red++; if (e.kind === 'read') redR++; else redS++; }
    }
    m.preRetrieval += preN; m.postRetrieval += postN;
    m.rederived += red; m.rederivedRead += redR; m.rederivedSearch += redS;
    m.perRollout.push(red);
    m.preShare.push(k / s.ev.length);
  }
  return m;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : 'n/a';

console.log('=== D13 — C-3 GATE 0: post-boundary re-derivation on the BASELINE ===');
console.log('Boundary = first edit call. "Re-derived" = a retrieval at/after the boundary whose');
console.log('target was ALREADY retrieved before it. This is the quantity C-3 must reduce.\n');

let grand = { rollouts: 0, post: 0, red: 0 };
for (const { dir, h } of CELLS) {
  const cellDir = path.join(R, dir);
  if (!existsSync(cellDir)) { console.log(`-- ${dir} (${h}): MISSING --\n`); continue; }
  const streams = STREAM[h](cellDir);
  if (!streams.length) { console.log(`-- ${dir} (${h}): no retained transcripts --\n`); continue; }
  const m = census(streams);
  const scored = m.rollouts - m.noEdit - m.noPost;
  console.log(`-- ${dir} (${h}) --  ${m.rollouts} rollouts (${scored} with a diagnosis AND an apply phase; ${m.noEdit} never edited, ${m.noPost} edited last)`);
  console.log(`   retrieval calls   pre-boundary ${m.preRetrieval}   post-boundary ${m.postRetrieval}`);
  console.log(`   RE-DERIVED        ${m.rederived}  = ${pct(m.rederived, m.postRetrieval)} of post-boundary retrievals   (${m.rederivedRead} reads, ${m.rederivedSearch} searches)`);
  console.log(`   per rollout       ${mean(m.perRollout).toFixed(2)} re-derivations   (max ${Math.max(0, ...m.perRollout)})`);
  console.log(`   boundary position ${(mean(m.preShare) * 100).toFixed(0)}% of calls happen BEFORE the first edit  <- the mass a reset deletes`);
  console.log('');
  grand.rollouts += scored; grand.post += m.postRetrieval; grand.red += m.rederived;
}
console.log('=== TIER (evidence doctrine §2) ===');
console.log(`mechanism fires ${grand.red} times across ${grand.rollouts} scored rollouts`);
const tier = grand.red >= 200 ? '200+  -> a microsmoke resolves it'
  : grand.red >= 20 ? '20-50 -> a microsmoke resolves a LARGE proximal effect only'
    : 'under 10 -> UNDECIDABLE on this corpus';
console.log(`tier: ${tier}`);
console.log(`\nre-derivation is ${pct(grand.red, grand.post)} of all post-boundary retrieval.`);
console.log('If that share is small, the apply phase is NOT re-deriving diagnosis facts, so deleting');
console.log('the diagnosis context cannot save those calls — it can only create new ones.');
